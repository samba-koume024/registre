
require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const limiteConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    succes: false,
    message: "Trop de tentatives. Réessayez dans 15 minutes."
  }
});
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DOSSIER_PUBLIC = path.join(__dirname, "public");
console.log("FICHIER CHARGÉ :", __filename);

// ======================================================
// 1. VÉRIFICATION DE LA CONFIGURATION
// ======================================================

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SECRET_KEY ||
  !process.env.SESSION_SECRET
) {
  console.error("Erreur : vérifie les variables de ton fichier .env.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ======================================================
// 2. CONFIGURATION EXPRESS ET DES SESSIONS
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "registre.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 8
}
  })
);

// ======================================================
// 3. FONCTIONS UTILITAIRES
// ======================================================

function reponseErreur(res, message, code = 400) {
  return res.status(code).json({
    succes: false,
    message
  });
}

function nettoyerTexte(valeur) {
  return typeof valeur === "string" ? valeur.trim() : "";
}

function normaliserTexte(valeur) {
  return nettoyerTexte(valeur)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normaliserTelephone(valeur) {
  return nettoyerTexte(valeur).replace(/\s+/g, "");
}

function normaliserEmail(valeur) {
  return nettoyerTexte(valeur).toLowerCase();
}

function telephoneValide(telephone) {
  return /^[0-9]{9}$/.test(telephone);
}

function emailValide(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function identifiantSession(req) {
  if (req.session.administrateur) {
    return {
      role: "administrateur",
      administrateur: req.session.administrateur
    };
  }

  if (req.session.membre) {
    return {
      role: req.session.membre.role,
      membre: req.session.membre
    };
  }

  return {
    role: null
  };
}

// ======================================================
// 4. MIDDLEWARES DE PROTECTION
// ======================================================

function exigerAdministrateur(req, res, next) {
  if (!req.session.administrateur) {
    return reponseErreur(
      res,
      "Accès réservé à l'administrateur.",
      401
    );
  }

  next();
}

function exigerMembreConnecte(req, res, next) {
  if (!req.session.membre && !req.session.administrateur) {
    return reponseErreur(
      res,
      "Vous devez être connecté.",
      401
    );
  }

  next();
}

function exigerBureauOuAdministrateur(req, res, next) {
  return exigerPermission("bureau.consulter")(req, res, next);
}

// ======================================================
// 5. SYSTEME DE PERMISSIONS DYNAMIQUES
// ======================================================

const normaliserFonction = t => String(t ?? "").trim().toLowerCase();

// Rôle appliqué quand aucun rôle n'a été attribué : « Bureau » pour un membre
// qui occupe une fonction du bureau, sinon « Membre ».
async function roleParDefaut(idMembre) {
  let dansLeBureau = false;

  const { data: postes } = await supabase
    .from("fonctions_bureau").select("id").eq("membre_id", idMembre).limit(1);
  if (postes && postes.length) dansLeBureau = true;

  if (!dansLeBureau) {
    const { data: ancien } = await supabase
      .from("bureau_membres").select("membre_id").eq("membre_id", idMembre).limit(1);
    if (ancien && ancien.length) dansLeBureau = true;
  }

  const { data: roles } = await supabase.from("rf_roles").select("id, nom");
  const nomCherche = dansLeBureau ? "bureau" : "membre";
  const trouve = (roles || []).find(
    r => String(r.nom).trim().toLowerCase() === nomCherche
  );
  return trouve ? trouve.id : null;
}

// Anciennes permissions déjà attribuées dans l'application : elles donnent
// aussi accès aux nouvelles rubriques correspondantes.
const PERMISSIONS_EQUIVALENTES = {
  "membres.voir": ["membres.consulter"],
  "programme.voir": ["bureau.consulter", "programme.consulter"]
};

async function verifierPermission(membreId, codePermission) {
  const codes = [codePermission, ...(PERMISSIONS_EQUIVALENTES[codePermission] || [])];
  for (const code of codes) {
    if (await verifierPermissionExacte(membreId, code)) return true;
  }
  return false;
}

async function verifierPermissionExacte(membreId, codePermission) {
  const idMembre = String(membreId);

  // 1. Rechercher la permission
  const { data: permission, error: erreurPermission } = await supabase
    .from("rf_permissions")
    .select("id")
    .eq("code", codePermission)
    .maybeSingle();

  if (erreurPermission) throw erreurPermission;
  if (!permission) return false;

  // 2. Vérifier une éventuelle exception individuelle
  const { data: exception, error: erreurException } = await supabase
    .from("rf_membre_permissions")
    .select("decision")
    .eq("membre_id", idMembre)
    .eq("permission_id", permission.id)
    .maybeSingle();

  if (erreurException) throw erreurException;

  // Une décision individuelle est prioritaire
  if (exception) {
    return exception.decision === "autoriser";
  }

  // 3. Permission accordée par le rôle du membre
  const { data: attribution, error: erreurRole } = await supabase
    .from("rf_membre_roles")
    .select("role_id")
    .eq("membre_id", idMembre)
    .maybeSingle();

  if (erreurRole) throw erreurRole;

  const roleEffectif = attribution ? attribution.role_id : await roleParDefaut(idMembre);

  if (roleEffectif) {
    const { data: autorisation, error: erreurAutorisation } = await supabase
      .from("rf_role_permissions")
      .select("id")
      .eq("role_id", roleEffectif)
      .eq("permission_id", permission.id)
      .maybeSingle();

    if (erreurAutorisation) throw erreurAutorisation;
    if (autorisation) return true;
  }

  // 4. Permission accordée par une fonction du bureau
  const { data: postes, error: erreurPostes } = await supabase
    .from("fonctions_bureau")
    .select("fonction")
    .eq("membre_id", idMembre);

  if (erreurPostes) throw erreurPostes;

  const fonctionsMembre = (postes || []).map(p => normaliserFonction(p.fonction));
  if (!fonctionsMembre.length) return false;

  const { data: parFonction, error: erreurFonction } = await supabase
    .from("rf_fonction_permissions")
    .select("fonction")
    .eq("permission_id", permission.id);

  if (erreurFonction) throw erreurFonction;

  return (parFonction || []).some(l =>
    fonctionsMembre.includes(normaliserFonction(l.fonction)));
}

// Middleware réutilisable pour protéger les routes
function exigerPermission(codePermission) {
  return async (req, res, next) => {
    // Tous les administrateurs ont automatiquement tous les droits
    if (req.session.administrateur) {
      return next();
    }

    // Vérifier la connexion du membre
    if (!req.session.membre) {
      return reponseErreur(
        res,
        "Vous devez être connecté.",
        401
      );
    }

    try {
      const autorise = await verifierPermission(
        req.session.membre.membre_id,
        codePermission
      );

      if (!autorise) {
        return reponseErreur(
          res,
          "Vous n'avez pas la permission nécessaire.",
          403
        );
      }

      next();
    } catch (erreur) {
      console.error("Erreur de vérification des permissions :", erreur);

      return reponseErreur(
        res,
        "Impossible de vérifier vos permissions.",
        500
      );
    }
  };
}


// ======================================================
// 5. DÉTERMINER LE RÔLE D'UN MEMBRE
// ======================================================

async function determinerRoleMembre(membre) {
  if (!membre || !membre.id) {
  return "membre";
}

  const { data, error } = await supabase
    .from("bureau_membres")
    .select("membre_id")
    .eq("membre_id", membre.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? "bureau" : "membre";
}

// ======================================================
// 6. CRÉER UNE SESSION MEMBRE
// ======================================================

function ouvrirSessionMembre(req, res, membre, compte, role) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((erreur) => {
      if (erreur) {
        return reject(erreur);
      }

      req.session.membre = {
        compte_id: compte.id,
        membre_id: membre.id,
        prenom: membre.prenom,
        nom: membre.nom,
        role
      };

      req.session.save((erreurSauvegarde) => {
        if (erreurSauvegarde) {
          return reject(erreurSauvegarde);
        }

        resolve();
      });
    });
  });
}

// ======================================================
// 5 bis. DROITS D'ACCÈS AUX RUBRIQUES DE GESTION
// ======================================================

const CODES_GESTION = [
  "membres.voir", "membres.inscrire", "membres.modifier", "membres.supprimer",
  "programme.voir", "programme.gerer", "pointages.gerer",
  "supervisions.voir", "rapports.voir",
  "reunions.voir", "reunions.gerer", "bureau.gerer",
  "cours.voir", "cours.gerer"
];

// Permissions qui donnent le droit de consulter la liste des membres
const ACCES_ANNUAIRE = [
  "membres.voir", "pointages.gerer", "reunions.voir", "reunions.gerer",
  "supervisions.voir", "rapports.voir", "programme.gerer",
  "cours.voir", "cours.gerer"
];

function idUtilisateur(req) {
  if (req.session.administrateur) return String(req.session.administrateur.id);
  return `membre-${req.session.membre.membre_id}`;
}

// Autorise l'accès si le membre possède AU MOINS UNE des permissions
function exigerUneDes(codes) {
  return async (req, res, next) => {
    if (req.session.administrateur) return next();
    if (!req.session.membre) {
      return reponseErreur(res, "Vous devez être connecté.", 401);
    }
    try {
      for (const code of codes) {
        if (await verifierPermission(req.session.membre.membre_id, code)) return next();
      }
      return reponseErreur(res, "Vous n'avez pas la permission nécessaire.", 403);
    } catch (erreur) {
      console.error(erreur);
      return reponseErreur(res, "Erreur lors de la vérification des permissions.", 500);
    }
  };
}

async function permissionsUtilisateur(req) {
  if (req.session.administrateur) return [...CODES_GESTION];
  if (!req.session.membre) return [];
  const accordees = [];
  for (const code of CODES_GESTION) {
    if (await verifierPermission(req.session.membre.membre_id, code)) accordees.push(code);
  }
  return accordees;
}

// ======================================================
// 7. PAGES HTML ET PROTECTION DES ACCÈS
// ======================================================

async function peutOuvrirApplication(req) {
  if (req.session.administrateur) return true;
  if (!req.session.membre) return false;
  try {
    return (await permissionsUtilisateur(req)).length > 0;
  } catch (erreur) {
    console.error(erreur);
    return false;
  }
}

app.get("/", async (req, res) => {
  if (await peutOuvrirApplication(req)) {
    return res.sendFile(path.join(DOSSIER_PUBLIC, "index.html"));
  }

  if (req.session.membre) {
    console.log(`[accès] membre ${req.session.membre.membre_id} : aucune permission de gestion trouvée, redirection vers sa page personnelle.`);
    if (req.session.membre.role === "bureau") {
      return res.redirect("/bureau.html");
    }

    return res.redirect("/information.html");
  }

  res.redirect("/connexion.html");
});

app.get("/index.html", async (req, res) => {
  if (await peutOuvrirApplication(req)) {
    return res.sendFile(path.join(DOSSIER_PUBLIC, "index.html"));
  }
  res.redirect("/connexion.html");
});

app.get("/bureau.html", exigerBureauOuAdministrateur, (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, "bureau.html"));
});

app.get("/information.html", exigerMembreConnecte, (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, "information.html"));
});

app.get("/connexion.html", (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, "connexion.html"));
});

app.get("/inscription.html", (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, "inscription.html"));
});

// Les fichiers CSS et JavaScript sont accessibles publiquement.
// Les pages privées ci-dessus sont protégées par leurs propres routes.
app.get("/sw.js", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.type("application/javascript");
  res.sendFile(path.join(DOSSIER_PUBLIC, "sw.js"));
});

app.use(express.static(DOSSIER_PUBLIC, { index: false }));

// ======================================================
// 8. INFORMATIONS SUR LA SESSION
// ======================================================

app.get("/api/auth/me", (req, res) => {
  res.json({
    connecte: Boolean(
      req.session.administrateur || req.session.membre
    ),
    ...identifiantSession(req)
  });
});

// ======================================================
// 9. CONNEXION ADMINISTRATEUR
// ======================================================

app.post("/api/auth/login", limiteConnexion, async (req, res) => {
  try {
    const identifiant = nettoyerTexte(req.body.identifiant);
    const motDePasse = req.body.mot_de_passe;

    if (!identifiant || !motDePasse) {
      return reponseErreur(
        res,
        "Veuillez remplir tous les champs."
      );
    }

    const { data: admin, error } = await supabase
      .from("administrateurs")
      .select("*")
      .eq("identifiant", identifiant)
      .maybeSingle();

    if (error) {
      console.error(error);
      return reponseErreur(
        res,
        "Erreur lors de la connexion.",
        500
      );
    }

    if (!admin) {
      return reponseErreur(
        res,
        "Identifiant ou mot de passe incorrect.",
        401
      );
    }

    const motDePasseCorrect = await bcrypt.compare(
      motDePasse,
      admin.mot_de_passe_hash
    );

    if (!motDePasseCorrect) {
      return reponseErreur(
        res,
        "Identifiant ou mot de passe incorrect.",
        401
      );
    }

    req.session.regenerate((erreur) => {
      if (erreur) {
        console.error(erreur);
        return reponseErreur(
          res,
          "Impossible de créer la session.",
          500
        );
      }

      req.session.administrateur = {
        id: admin.id,
        identifiant: admin.identifiant
      };

      req.session.save((erreurSauvegarde) => {
        if (erreurSauvegarde) {
          console.error(erreurSauvegarde);
          return reponseErreur(
            res,
            "Impossible de sauvegarder la session.",
            500
          );
        }

        res.json({
          succes: true,
          message: "Connexion administrateur réussie.",
          role: "administrateur"
        });
      });
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Une erreur est survenue.", 500);
  }
});

// ======================================================
// 10. INSCRIPTION D'UN MEMBRE
// ======================================================


// Les comptes sont créés uniquement par l'administrateur (rubrique « Gestion des comptes »).
// Passer cette valeur à true rouvrirait l'inscription libre avec confirmation par e-mail.
const INSCRIPTION_LIBRE = false;

app.post("/api/auth/inscription-membre", async (req, res) => {
  if (!INSCRIPTION_LIBRE) {
    return reponseErreur(
      res,
      "La création de compte est réservée à l'administrateur. Contactez-le pour obtenir votre accès.",
      403
    );
  }

  try {
    const prenom = nettoyerTexte(req.body.prenom);
    const nom = nettoyerTexte(req.body.nom);
    const telephone = normaliserTelephone(req.body.telephone);
    const email = normaliserEmail(req.body.email);
    const motDePasse = req.body.mot_de_passe;

    if (!prenom || !nom || !motDePasse) {
      return reponseErreur(
        res,
        "Le prénom, le nom et le mot de passe sont obligatoires."
      );
    }

    if (!telephone && !email) {
      return reponseErreur(
        res,
        "Vous devez fournir un téléphone ou une adresse e-mail."
      );
    }

    if (telephone && !telephoneValide(telephone)) {
      return reponseErreur(
        res,
        "Le numéro de téléphone doit contenir exactement 9 chiffres."
      );
    }

    if (email && !emailValide(email)) {
      return reponseErreur(
        res,
        "L'adresse e-mail n'est pas valide."
      );
    }

    if (typeof motDePasse !== "string" || motDePasse.length < 8) {
      return reponseErreur(
        res,
        "Le mot de passe doit contenir au moins 8 caractères."
      );
    }

    // Récupérer les fiches membres.
    const { data: candidats, error: erreurRecherche } = await supabase
      .from("membres")
      .select("*");
      console.log("Prénom reçu :", JSON.stringify(prenom));
console.log("Nom reçu :", JSON.stringify(nom));
console.log("Fiches trouvées :", candidats?.length);

console.log(
  "Noms dans Supabase :",
  candidats?.map(m => ({
    prenom: m.prenom,
    nom: m.nom
  }))
);
      console.log("Prénom reçu :", JSON.stringify(prenom));
console.log("Nom reçu :", JSON.stringify(nom));
console.log("Fiches trouvées :", candidats?.length);
console.log(
  "Noms dans Supabase :",
  candidats?.map(m => ({
    prenom: m.prenom,
    nom: m.nom
  }))
);

    if (erreurRecherche) {
      console.error(erreurRecherche);
      return reponseErreur(
        res,
        "Impossible de vérifier votre inscription.",
        500
      );
    }

    // Identifier le membre grâce au prénom et au nom.
   // Retrouver le membre grâce au téléphone en priorité.
let correspondances = (candidats || []).filter((m) => {
  const memeTelephone =
    telephone &&
    normaliserTelephone(m.telephone || "") === telephone;

  const memeEmail =
    email &&
    normaliserEmail(m.email || "") === email;

  const memePrenom =
    normaliserTexte(m.prenom) === normaliserTexte(prenom);

  const memeNom =
    normaliserTexte(m.nom) === normaliserTexte(nom);

  return (memeTelephone || memeEmail) && memePrenom && memeNom;
});

console.log("Membres retrouvés :", correspondances.length);

if (correspondances.length === 0) {
  return reponseErreur(
    res,
    "Aucune fiche membre ne correspond à ces informations."
  );
}

if (correspondances.length > 1) {
  return reponseErreur(
    res,
    "Plusieurs fiches correspondent à ces informations. Contactez l'administrateur."
  );
}

const membre = correspondances[0];
// Vérifier également le prénom et le nom.
if (
  normaliserTexte(membre.prenom) !== normaliserTexte(prenom) ||
  normaliserTexte(membre.nom) !== normaliserTexte(nom)
) {
  return reponseErreur(
    res,
    "Le prénom ou le nom ne correspond pas à votre fiche membre."
  );
}

    // Vérifier les coordonnées déjà enregistrées.
    const telephoneExistant = normaliserTelephone(
      membre.telephone || ""
    );

    const emailExistant = normaliserEmail(
      membre.email || ""
    );

    // Un contact déjà renseigné doit obligatoirement correspondre.
    if (
      telephone &&
      telephoneExistant &&
      telephone !== telephoneExistant
    ) {
      return reponseErreur(
        res,
        "Le téléphone fourni ne correspond pas à votre fiche membre."
      );
    }

    if (
      email &&
      emailExistant &&
      email !== emailExistant
    ) {
      return reponseErreur(
        res,
        "L'adresse e-mail fournie ne correspond pas à votre fiche membre."
      );
    }

    // Ne pas écraser une coordonnée existante.
    const nouvellesDonnees = {};

    if (telephone && !telephoneExistant) {
      nouvellesDonnees.telephone = telephone;
    }

    if (email && !emailExistant) {
      nouvellesDonnees.email = email;
    }

    // Vérifier qu'un compte n'existe pas déjà.
    const { data: compteExistant, error: erreurCompte } = await supabase
      .from("comptes_membres")
      .select("id")
      .eq("membre_id", membre.id)
      .maybeSingle();

    if (erreurCompte) {
      console.error(erreurCompte);
      return reponseErreur(
        res,
        "Impossible de vérifier votre compte.",
        500
      );
    }

    if (compteExistant) {
      return reponseErreur(
        res,
        "Un compte existe déjà pour cette fiche membre."
      );
    }

    // Vérifier que les nouvelles coordonnées ne sont pas déjà utilisées.
    if (telephone && !telephoneExistant) {
      const { data: autreTelephone, error } = await supabase
        .from("membres")
        .select("id")
        .eq("telephone", telephone)
        .neq("id", membre.id);

      if (error) {
        console.error(error);
        return reponseErreur(res, "Erreur de vérification du téléphone.", 500);
      }

      if (autreTelephone && autreTelephone.length > 0) {
        return reponseErreur(
          res,
          "Ce téléphone est déjà associé à une autre fiche membre."
        );
      }
    }

    if (email && !emailExistant) {
      const { data: autreEmail, error } = await supabase
        .from("membres")
        .select("id")
        .eq("email", email)
        .neq("id", membre.id);

      if (error) {
        console.error(error);
        return reponseErreur(res, "Erreur de vérification de l'e-mail.", 500);
      }

      if (autreEmail && autreEmail.length > 0) {
        return reponseErreur(
          res,
          "Cet e-mail est déjà associé à une autre fiche membre."
        );
      }
    }

    // Mettre à jour les coordonnées manquantes dans Supabase.
    if (Object.keys(nouvellesDonnees).length > 0) {
      const { data: membreMisAJour, error: erreurMiseAJour } = await supabase
        .from("membres")
        .update(nouvellesDonnees)
        .eq("id", membre.id)
        .select()
        .single();

      if (erreurMiseAJour) {
        console.error(erreurMiseAJour);
        return reponseErreur(
          res,
          "Impossible d'enregistrer vos nouvelles coordonnées.",
          500
        );
      }

      Object.assign(membre, membreMisAJour);
    }

    // Déterminer le rôle du membre.
    const role = await determinerRoleMembre(membre);

    const motDePasseHash = await bcrypt.hash(motDePasse, 12);

    const { data: nouveauCompte, error: erreurCreation } = await supabase
      .from("comptes_membres")
      .insert({
        membre_id: membre.id,
        mot_de_passe_hash: motDePasseHash,
        compte_verifie: true,
        actif: true
      })
      .select()
      .single();

    if (erreurCreation) {
      console.error(erreurCreation);

      if (erreurCreation.code === "23505") {
        return reponseErreur(
          res,
          "Un compte existe déjà pour cette fiche membre."
        );
      }

      return reponseErreur(
        res,
        "La création du compte a échoué.",
        500
      );
    }

    await ouvrirSessionMembre(
      req,
      res,
      membre,
      nouveauCompte,
      role
    );

    res.status(201).json({
      succes: true,
      message: "Votre compte a été créé avec succès.",
      role
    });

  } catch (erreur) {
    console.error(erreur);
    reponseErreur(
      res,
      "Une erreur est survenue pendant l'inscription.",
      500
    );
  }
});


// ======================================================
// 11. CONNEXION D'UN MEMBRE
// ======================================================

app.post("/api/auth/connexion-membre", limiteConnexion, async (req, res) => {
  try {
    const identifiant = nettoyerTexte(req.body.identifiant);
    const motDePasse = req.body.mot_de_passe;

    if (!identifiant || !motDePasse) {
      return reponseErreur(
        res,
        "Veuillez remplir tous les champs."
      );
    }

    const estEmail = identifiant.includes("@");

    let requete = supabase
      .from("membres")
      .select("*");

    if (estEmail) {
      requete = requete.eq("email", normaliserEmail(identifiant));
    } else {
      const telephone = normaliserTelephone(identifiant);

      if (!telephoneValide(telephone)) {
        return reponseErreur(
          res,
          "Utilisez une adresse e-mail ou un numéro à 9 chiffres."
        );
      }

      requete = requete.eq("telephone", telephone);
    }

    const { data: membre, error: erreurMembre } = await requete.maybeSingle();

    if (erreurMembre) {
      console.error(erreurMembre);
      return reponseErreur(
        res,
        "Erreur lors de la recherche du membre.",
        500
      );
    }

    if (!membre) {
      return reponseErreur(
        res,
        "Identifiant ou mot de passe incorrect.",
        401
      );
    }

    const { data: compte, error: erreurCompte } = await supabase
      .from("comptes_membres")
      .select("*")
      .eq("membre_id", membre.id)
      .maybeSingle();

    if (erreurCompte) {
      console.error(erreurCompte);
      return reponseErreur(
        res,
        "Erreur lors de la vérification du compte.",
        500
      );
    }

    if (!compte || compte.actif !== true) {
      return reponseErreur(
        res,
        "Ce compte n'existe pas ou est désactivé.",
        401
      );
    }

    const motDePasseCorrect = await bcrypt.compare(
      motDePasse,
      compte.mot_de_passe_hash
    );

    if (!motDePasseCorrect) {
      return reponseErreur(
        res,
        "Identifiant ou mot de passe incorrect.",
        401
      );
    }


    let role = await determinerRoleMembre(membre);

    await ouvrirSessionMembre(
      req,
      res,
      membre,
      compte,
      role
    );

    // Un membre promu administrateur obtient tous les droits.
    const { data: promotion } = await supabase
      .from("rf_membres_administrateurs")
      .select("membre_id")
      .eq("membre_id", String(membre.id))
      .maybeSingle();

    if (promotion) {
      req.session.administrateur = {
        id: `membre-${membre.id}`,
        identifiant: `${membre.prenom} ${membre.nom}`,
        membre_id: membre.id
      };
      await new Promise((ok, ko) =>
        req.session.save(e => (e ? ko(e) : ok()))
      );
      role = "administrateur";
    }

    res.json({
      succes: true,
      message: "Connexion réussie.",
      role
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(
      res,
      "Une erreur est survenue pendant la connexion.",
      500
    );
  }
});

// ======================================================
// 12. DÉCONNEXION
// ======================================================

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((erreur) => {
    if (erreur) {
      console.error(erreur);
      return reponseErreur(
        res,
        "La déconnexion a échoué.",
        500
      );
    }

    res.clearCookie("registre.sid");

    res.json({
      succes: true,
      message: "Déconnexion réussie."
    });
  });
});

// ======================================================
// 13. STATUT DU SERVEUR
// ======================================================

app.get("/api/status", (req, res) => {
  res.json({
    serveur: "Registre Fogny",
    statut: "en ligne"
  });
});

// ======================================================
// 14. PROGRAMME HEBDOMADAIRE : LECTURE
// ======================================================

app.get(
  "/api/programme",
  exigerUneDes(["programme.voir", "pointages.gerer", "bureau.consulter", "cours.voir", "cours.gerer"]),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("programmes_hebdomadaires")
        .select("*")
        .order("ordre", { ascending: true })
        .order("heure_debut", { ascending: true });

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de charger le programme.",
          500
        );
      }

      res.json(data || []);
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 15. PROGRAMME : AJOUT
// ======================================================

const JOURS_AUTORISES = [
  "Lundi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche"
];

function validerActivite(body) {
  const jour = nettoyerTexte(body.jour);
  const heureDebut = nettoyerTexte(body.heure_debut);
  const heureFin = nettoyerTexte(body.heure_fin);
  const activite = nettoyerTexte(body.activite);

  if (!JOURS_AUTORISES.includes(jour)) {
    return "Jour invalide.";
  }

  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(heureDebut) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(heureFin)
  ) {
    return "Les heures doivent être au format HH:MM.";
  }

  if (heureFin <= heureDebut) {
    return "L'heure de fin doit être après l'heure de début.";
  }

  if (!activite) {
    return "Le nom de l'activité est obligatoire.";
  }

  return null;
}

app.post(
  "/api/programme",
  exigerPermission("programme.gerer"),
  async (req, res) => {
    try {
      const erreurValidation = validerActivite(req.body);

      if (erreurValidation) {
        return reponseErreur(res, erreurValidation);
      }

      const nouvelleActivite = {
        jour: nettoyerTexte(req.body.jour),
        heure_debut: nettoyerTexte(req.body.heure_debut),
        heure_fin: nettoyerTexte(req.body.heure_fin),
        activite: nettoyerTexte(req.body.activite),
        lieu: nettoyerTexte(req.body.lieu),
        observations: nettoyerTexte(req.body.observations)
      };

      const { data, error } = await supabase
        .from("programmes_hebdomadaires")
        .insert(nouvelleActivite)
        .select()
        .single();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible d'ajouter cette activité.",
          500
        );
      }

      res.status(201).json({
        succes: true,
        message: "Activité ajoutée.",
        activite: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 16. PROGRAMME : MODIFICATION
// ======================================================

app.put(
  "/api/programme/:id",
  exigerPermission("programme.gerer"),
  async (req, res) => {
    try {
      const erreurValidation = validerActivite(req.body);

      if (erreurValidation) {
        return reponseErreur(res, erreurValidation);
      }

      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return reponseErreur(res, "Identifiant invalide.");
      }

      const modifications = {
        jour: nettoyerTexte(req.body.jour),
        heure_debut: nettoyerTexte(req.body.heure_debut),
        heure_fin: nettoyerTexte(req.body.heure_fin),
        activite: nettoyerTexte(req.body.activite),
        lieu: nettoyerTexte(req.body.lieu),
        observations: nettoyerTexte(req.body.observations)
      };

      const { data, error } = await supabase
        .from("programmes_hebdomadaires")
        .update(modifications)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de modifier cette activité.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Activité introuvable.", 404);
      }

      res.json({
        succes: true,
        message: "Activité modifiée.",
        activite: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 17. PROGRAMME : SUPPRESSION
// ======================================================

app.delete(
  "/api/programme/:id",
  exigerPermission("programme.gerer"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return reponseErreur(res, "Identifiant invalide.");
      }

      const { data, error } = await supabase
        .from("programmes_hebdomadaires")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de supprimer cette activité.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Activité introuvable.", 404);
      }

      res.json({
        succes: true,
        message: "Activité supprimée."
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 18. MEMBRES : AJOUT PAR L'ADMINISTRATEUR
// ======================================================

app.post(
  "/api/membres",
  exigerPermission("membres.inscrire"),
  async (req, res) => {
    try {
      const prenom = nettoyerTexte(req.body.prenom);
      const nom = nettoyerTexte(req.body.nom);
      const sexe = nettoyerTexte(req.body.sexe);
      const dateNaissance = nettoyerTexte(req.body.date_naissance);
      const telephone = normaliserTelephone(req.body.telephone);
      const email = normaliserEmail(req.body.email);

      if (!prenom || !nom || !sexe || !dateNaissance) {
  return reponseErreur(
    res,
    "Le prénom, le nom, le sexe et la date de naissance sont obligatoires."
  );
}

const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(dateNaissance);

if (!dateValide || Number.isNaN(Date.parse(dateNaissance))) {
  return reponseErreur(res, "Date de naissance invalide.");
}
const naissance = new Date(`${dateNaissance}T00:00:00`);
const aujourdHui = new Date();

let age = aujourdHui.getFullYear() - naissance.getFullYear();

if (
  aujourdHui.getMonth() < naissance.getMonth() ||
  (aujourdHui.getMonth() === naissance.getMonth() &&
   aujourdHui.getDate() < naissance.getDate())
) {
  age--;
}

let categorie;

if (age < 25) {
  categorie = "Cadets";
} else if (sexe === "Masculin") {
  categorie = "Hommes";
} else if (sexe === "Féminin") {
  categorie = "Femmes";
} else {
  return reponseErreur(res, "Sexe invalide.");
}

      if (!telephone && !email) {
        return reponseErreur(
          res,
          "Un téléphone ou un e-mail est nécessaire."
        );
      }

      if (telephone && !telephoneValide(telephone)) {
        return reponseErreur(
          res,
          "Le téléphone doit contenir 9 chiffres."
        );
      }

      if (email && !emailValide(email)) {
        return reponseErreur(res, "Adresse e-mail invalide.");
      }

      const nouveauMembre = {
  prenom,
  nom,
  sexe,
  categorie,
  telephone: telephone || null,
  email: email || null,
  date_naissance: dateNaissance,
  profession: nettoyerTexte(req.body.profession) || null
};

      const { data, error } = await supabase
        .from("membres")
        .insert(nouveauMembre)
        .select()
        .single();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible d'enregistrer ce membre.",
          500
        );
      }

      res.status(201).json({
        succes: true,
        message: "Membre enregistré.",
        membre: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 19. MEMBRES : LISTE
// ======================================================

app.get(
  "/api/membres",
  exigerUneDes(ACCES_ANNUAIRE),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("membres")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de charger les membres.",
          500
        );
      }

      res.json(data || []);
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);
// Récupérer les fonctions du bureau
app.get(
  "/api/bureau",
  exigerUneDes([...ACCES_ANNUAIRE, "bureau.gerer", "bureau.consulter"]),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("fonctions_bureau")
        .select(`
          id,
          membre_id,
          fonction,
          date_attribution,
          membres (
            id,
            prenom,
            nom,
            telephone
          )
        `)
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de charger les membres du bureau.",
          500
        );
      }

      res.json({
        succes: true,
        bureau: data || []
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);
// Attribuer une fonction à un membre du bureau
app.post(
  "/api/bureau",
  exigerPermission("bureau.gerer"),
  async (req, res) => {
    try {
      const membreId = Number(req.body.membre_id);
      const fonction = nettoyerTexte(req.body.fonction);

      if (!Number.isInteger(membreId) || membreId <= 0 || !fonction) {
        return reponseErreur(
          res,
          "Sélectionnez un membre et indiquez une fonction."
        );
      }

      // Vérifier que le membre existe déjà
      const { data: membre, error: erreurMembre } = await supabase
        .from("membres")
        .select("id")
        .eq("id", membreId)
        .maybeSingle();

      if (erreurMembre || !membre) {
        return reponseErreur(
          res,
          "Ce membre n'existe pas dans la liste générale.",
          404
        );
      }

      // Attribuer la fonction
      const { data, error } = await supabase
        .from("fonctions_bureau")
        .insert({
          membre_id: membreId,
          fonction
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          return reponseErreur(
            res,
            "Cette fonction est déjà attribuée à ce membre."
          );
        }

        console.error(error);
        return reponseErreur(
          res,
          "Impossible d'attribuer cette fonction.",
          500
        );
      }

      res.status(201).json({
        succes: true,
        message: "Fonction attribuée avec succès.",
        attribution: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);
// Retirer une fonction du bureau
app.delete(
  "/api/bureau/:id",
  exigerPermission("bureau.gerer"),
  async (req, res) => {
    try {
      const attributionId = Number(req.params.id);

      if (!Number.isInteger(attributionId) || attributionId <= 0) {
        return reponseErreur(res, "Identifiant invalide.");
      }

      const { data, error } = await supabase
        .from("fonctions_bureau")
        .delete()
        .eq("id", attributionId)
        .select()
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de retirer cette fonction.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Cette attribution est introuvable.", 404);
      }

      res.json({
        succes: true,
        message: "Fonction retirée avec succès."
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

app.get(
  "/api/membres/mon-profil",
  exigerMembreConnecte,
  async (req, res) => {
    try {
      if (req.session.administrateur) {
        return reponseErreur(
          res,
          "Cette page est réservée aux comptes membres.",
          403
        );
      }

      const membreId = req.session.membre.membre_id;

      const { data, error } = await supabase
        .from("membres")
        .select("*")
        .eq("id", membreId)
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de charger votre profil.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Fiche membre introuvable.", 404);
      }

      res.json({
        succes: true,
        membre: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);


// ======================================================
// 20. MEMBRES : MODIFICATION
// ======================================================

app.put(
  "/api/membres/:id",
  exigerPermission("membres.modifier"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return reponseErreur(res, "Identifiant invalide.");
       }
     const prenom = nettoyerTexte(req.body.prenom);
const nom = nettoyerTexte(req.body.nom);
const sexe = nettoyerTexte(req.body.sexe);
const dateNaissance = nettoyerTexte(req.body.date_naissance);
const telephone = normaliserTelephone(req.body.telephone);
const email = normaliserEmail(req.body.email);

if (!prenom || !nom || !sexe || !dateNaissance) {
  return reponseErreur(
    res,
    "Le prénom, le nom, le sexe et la date de naissance sont obligatoires."
  );
}

if (!["Masculin", "Féminin"].includes(sexe)) {
  return reponseErreur(res, "Sexe invalide.");
}

const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(dateNaissance);

if (!dateValide || Number.isNaN(Date.parse(dateNaissance))) {
  return reponseErreur(res, "Date de naissance invalide.");
}

const naissance = new Date(`${dateNaissance}T00:00:00`);
const aujourdHui = new Date();

let age = aujourdHui.getFullYear() - naissance.getFullYear();

if (
  aujourdHui.getMonth() < naissance.getMonth() ||
  (aujourdHui.getMonth() === naissance.getMonth() &&
   aujourdHui.getDate() < naissance.getDate())
) {
  age--;
}

let categorie;

if (age < 25) {
  categorie = "Cadets";
} else if (sexe === "Masculin") {
  categorie = "Hommes";
} else {
  categorie = "Femmes";
}
      if (!telephone && !email) {
        return reponseErreur(
          res,
          "Un téléphone ou un e-mail est nécessaire."
        );
      }

      if (telephone && !telephoneValide(telephone)) {
        return reponseErreur(
          res,
          "Le téléphone doit contenir 9 chiffres."
        );
      }

      if (email && !emailValide(email)) {
        return reponseErreur(res, "Adresse e-mail invalide.");
      }

      const modifications = {
        prenom,
        nom,
        sexe,
        categorie,
        telephone: telephone || null,
        email: email || null,
        date_naissance: dateNaissance,
        profession: nettoyerTexte(req.body.profession) || null
      };

      const { data, error } = await supabase
        .from("membres")
        .update(modifications)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de modifier ce membre.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Membre introuvable.", 404);
      }

      res.json({
        succes: true,
        message: "Membre modifié.",
        membre: data
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 21. MEMBRES : SUPPRESSION
// ======================================================

app.delete(
  "/api/membres/:id",
  exigerPermission("membres.supprimer"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return reponseErreur(res, "Identifiant invalide.");
      }

      const { data, error } = await supabase
        .from("membres")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Impossible de supprimer ce membre.",
          500
        );
      }

      if (!data) {
        return reponseErreur(res, "Membre introuvable.", 404);
      }

      res.json({
        succes: true,
        message: "Membre supprimé."
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);

// ======================================================
// 22. PAGE INTROUVABLE
// ======================================================

// ======================================================



// ======================================================
// 22. GESTION DES RÔLES ET DES PERMISSIONS
// ======================================================

function uuidValide(valeur) {
  return typeof valeur === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valeur);
}

// Consulter le catalogue des permissions.
app.get("/api/permissions", exigerAdministrateur, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rf_permissions")
      .select("id, code, nom, description, module")
      .order("module", { ascending: true })
      .order("nom", { ascending: true });

    if (error) {
      console.error("Erreur catalogue permissions :", error);
      return reponseErreur(res, "Impossible de charger les permissions.", 500);
    }

    res.json(data || []);
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Consulter les rôles avec les permissions qui leur sont associées.
app.get("/api/roles", exigerAdministrateur, async (req, res) => {
  try {
    const [{ data: roles, error: erreurRoles }, { data: liens, error: erreurLiens }] =
      await Promise.all([
        supabase
          .from("rf_roles")
          .select("id, nom, description, est_systeme, date_creation")
          .order("est_systeme", { ascending: false })
          .order("nom", { ascending: true }),
        supabase
          .from("rf_role_permissions")
          .select("role_id, permission_id")
      ]);

    if (erreurRoles || erreurLiens) {
      console.error(erreurRoles || erreurLiens);
      return reponseErreur(res, "Impossible de charger les rôles.", 500);
    }

    const rolesAvecPermissions = (roles || []).map(role => ({
      ...role,
      permission_ids: (liens || [])
        .filter(lien => lien.role_id === role.id)
        .map(lien => lien.permission_id)
    }));

    res.json(rolesAvecPermissions);
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Créer un rôle personnalisé.
app.post("/api/roles", exigerAdministrateur, async (req, res) => {
  try {
    const nom = nettoyerTexte(req.body.nom);
    const description = nettoyerTexte(req.body.description);

    if (!nom || nom.length < 2 || nom.length > 50) {
      return reponseErreur(res, "Le nom du rôle doit contenir entre 2 et 50 caractères.");
    }

    const { data, error } = await supabase
      .from("rf_roles")
      .insert({
        nom,
        description: description || null,
        est_systeme: false
      })
      .select("id, nom, description, est_systeme, date_creation")
      .single();

    if (error) {
      if (error.code === "23505") {
        return reponseErreur(res, "Un rôle porte déjà ce nom.");
      }
      console.error(error);
      return reponseErreur(res, "Impossible de créer le rôle.", 500);
    }

    res.status(201).json({
      succes: true,
      message: "Rôle créé.",
      role: { ...data, permission_ids: [] }
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Modifier le nom et la description d'un rôle personnalisé.
app.put("/api/roles/:id", exigerAdministrateur, async (req, res) => {
  try {
    const roleId = req.params.id;
    const nom = nettoyerTexte(req.body.nom);
    const description = nettoyerTexte(req.body.description);

    if (!uuidValide(roleId)) {
      return reponseErreur(res, "Identifiant de rôle invalide.");
    }

    if (!nom || nom.length < 2 || nom.length > 50) {
      return reponseErreur(res, "Le nom du rôle doit contenir entre 2 et 50 caractères.");
    }

    const { data: roleExistant, error: erreurRecherche } = await supabase
      .from("rf_roles")
      .select("id, est_systeme")
      .eq("id", roleId)
      .maybeSingle();

    if (erreurRecherche) {
      console.error(erreurRecherche);
      return reponseErreur(res, "Impossible de vérifier le rôle.", 500);
    }
    if (!roleExistant) return reponseErreur(res, "Rôle introuvable.", 404);
    if (roleExistant.est_systeme) {
      return reponseErreur(res, "Le nom d'un rôle système ne peut pas être modifié.", 403);
    }

    const { data, error } = await supabase
      .from("rf_roles")
      .update({ nom, description: description || null })
      .eq("id", roleId)
      .select("id, nom, description, est_systeme, date_creation")
      .single();

    if (error) {
      if (error.code === "23505") return reponseErreur(res, "Un rôle porte déjà ce nom.");
      console.error(error);
      return reponseErreur(res, "Impossible de modifier le rôle.", 500);
    }

    res.json({ succes: true, message: "Rôle modifié.", role: data });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Remplacer les permissions associées à un rôle.
app.put("/api/roles/:id/permissions", exigerAdministrateur, async (req, res) => {
  try {
    const roleId = req.params.id;
    const permissionIds = req.body.permission_ids;

    if (!uuidValide(roleId)) {
      return reponseErreur(res, "Identifiant de rôle invalide.");
    }

    if (!Array.isArray(permissionIds) || permissionIds.some(id => !uuidValide(id))) {
      return reponseErreur(res, "La liste des permissions est invalide.");
    }

    const idsUniques = [...new Set(permissionIds)];

    const { data: role, error: erreurRole } = await supabase
      .from("rf_roles")
      .select("id")
      .eq("id", roleId)
      .maybeSingle();

    if (erreurRole) {
      console.error(erreurRole);
      return reponseErreur(res, "Impossible de vérifier le rôle.", 500);
    }
    if (!role) return reponseErreur(res, "Rôle introuvable.", 404);

    if (idsUniques.length > 0) {
      const { data: permissions, error: erreurPermissions } = await supabase
        .from("rf_permissions")
        .select("id")
        .in("id", idsUniques);

      if (erreurPermissions) {
        console.error(erreurPermissions);
        return reponseErreur(res, "Impossible de vérifier les permissions.", 500);
      }
      if ((permissions || []).length !== idsUniques.length) {
        return reponseErreur(res, "Une ou plusieurs permissions n'existent pas.");
      }
    }

    const { data: actuelles, error: erreurActuelles } = await supabase
      .from("rf_role_permissions")
      .select("permission_id")
      .eq("role_id", roleId);

    if (erreurActuelles) {
      console.error(erreurActuelles);
      return reponseErreur(res, "Impossible de lire les permissions actuelles.", 500);
    }

    const idsActuels = (actuelles || []).map(lien => lien.permission_id);
    const aRetirer = idsActuels.filter(id => !idsUniques.includes(id));
    const aAjouter = idsUniques.filter(id => !idsActuels.includes(id));

    // Retirer d'abord les droits devenus inutiles : en cas d'échec ultérieur,
    // le système reste restrictif plutôt que d'accorder des droits supplémentaires.
    for (const permissionId of aRetirer) {
      const { error } = await supabase
        .from("rf_role_permissions")
        .delete()
        .eq("role_id", roleId)
        .eq("permission_id", permissionId);

      if (error) {
        console.error(error);
        return reponseErreur(res, "Impossible de retirer une permission du rôle.", 500);
      }
    }

    if (aAjouter.length > 0) {
      const lignes = aAjouter.map(permission_id => ({
        role_id: roleId,
        permission_id
      }));

      const { error } = await supabase
        .from("rf_role_permissions")
        .insert(lignes);

      if (error) {
        console.error(error);
        return reponseErreur(
          res,
          "Certaines permissions n'ont pas pu être ajoutées. Vérifiez la configuration du rôle.",
          500
        );
      }
    }

    res.json({
      succes: true,
      message: "Permissions du rôle mises à jour.",
      permission_ids: idsUniques
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Supprimer un rôle personnalisé non attribué à un membre.
app.delete("/api/roles/:id", exigerAdministrateur, async (req, res) => {
  try {
    const roleId = req.params.id;

    if (!uuidValide(roleId)) {
      return reponseErreur(res, "Identifiant de rôle invalide.");
    }

    const { data: role, error: erreurRole } = await supabase
      .from("rf_roles")
      .select("id, est_systeme")
      .eq("id", roleId)
      .maybeSingle();

    if (erreurRole) {
      console.error(erreurRole);
      return reponseErreur(res, "Impossible de vérifier le rôle.", 500);
    }
    if (!role) return reponseErreur(res, "Rôle introuvable.", 404);
    if (role.est_systeme) {
      return reponseErreur(res, "Les rôles système ne peuvent pas être supprimés.", 403);
    }

    const { data: attributions, error: erreurAttributions } = await supabase
      .from("rf_membre_roles")
      .select("membre_id")
      .eq("role_id", roleId)
      .limit(1);

    if (erreurAttributions) {
      console.error(erreurAttributions);
      return reponseErreur(res, "Impossible de vérifier les membres associés.", 500);
    }
    if ((attributions || []).length > 0) {
      return reponseErreur(
        res,
        "Ce rôle est encore attribué à un membre. Réattribuez d'abord ces membres.",
        409
      );
    }

    const { error } = await supabase
      .from("rf_roles")
      .delete()
      .eq("id", roleId);

    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible de supprimer le rôle.", 500);
    }

    res.json({ succes: true, message: "Rôle supprimé." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Consulter le rôle et les permissions effectives d'un membre.
app.get("/api/membres/:id/permissions", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(req.params.id);
    if (!membreId) return reponseErreur(res, "Identifiant de membre invalide.");

    const [
      { data: membre, error: erreurMembre },
      { data: attribution, error: erreurAttribution },
      { data: permissions, error: erreurPermissions },
      { data: exceptions, error: erreurExceptions }
    ] = await Promise.all([
      supabase.from("membres").select("id, prenom, nom").eq("id", membreId).maybeSingle(),
      supabase.from("rf_membre_roles").select("role_id").eq("membre_id", membreId).maybeSingle(),
      supabase.from("rf_permissions").select("id, code, nom, description, module").order("module"),
      supabase.from("rf_membre_permissions").select("permission_id, decision").eq("membre_id", membreId)
    ]);

    const erreurLecture = erreurMembre || erreurAttribution || erreurPermissions || erreurExceptions;
    if (erreurLecture) {
      console.error(erreurLecture);
      return reponseErreur(res, "Impossible de charger les permissions du membre.", 500);
    }
    if (!membre) return reponseErreur(res, "Membre introuvable.", 404);

    let role = null;
    let idsRole = [];

    const roleEffectif = attribution ? attribution.role_id : await roleParDefaut(String(membreId));

    if (roleEffectif) {
      const { data: roleData, error: erreurRole } = await supabase
        .from("rf_roles")
        .select("id, nom, description, est_systeme")
        .eq("id", roleEffectif)
        .maybeSingle();

      if (erreurRole) {
        console.error(erreurRole);
        return reponseErreur(res, "Impossible de charger le rôle du membre.", 500);
      }
      role = roleData;

      const { data: liens, error: erreurLiens } = await supabase
        .from("rf_role_permissions")
        .select("permission_id")
        .eq("role_id", roleEffectif);

      if (erreurLiens) {
        console.error(erreurLiens);
        return reponseErreur(res, "Impossible de charger les droits du rôle.", 500);
      }
      idsRole = (liens || []).map(lien => lien.permission_id);
    }

    let idsFonction = [];
    const { data: postes } = await supabase
      .from("fonctions_bureau").select("fonction").eq("membre_id", membreId);
    const fonctionsMembre = (postes || []).map(p => normaliserFonction(p.fonction));
    if (fonctionsMembre.length) {
      const { data: liensFonction } = await supabase
        .from("rf_fonction_permissions").select("fonction, permission_id");
      idsFonction = (liensFonction || [])
        .filter(l => fonctionsMembre.includes(normaliserFonction(l.fonction)))
        .map(l => l.permission_id);
    }

    const decisions = new Map(
      (exceptions || []).map(exception => [exception.permission_id, exception.decision])
    );

    const droits = (permissions || []).map(permission => {
      const decision = decisions.get(permission.id) || null;
      const autorisationRole = idsRole.includes(permission.id);

      return {
        ...permission,
        autorisation_role: autorisationRole || idsFonction.includes(permission.id),
        autorisation_fonction: idsFonction.includes(permission.id),
        decision_individuelle: decision,
        autorisee: decision
          ? decision === "autoriser"
          : autorisationRole || idsFonction.includes(permission.id)
      };
    });

    res.json({ succes: true, membre, role, permissions: droits });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Attribuer un rôle à un membre.
app.put("/api/membres/:id/role", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(req.params.id);
    const roleId = req.body.role_id;

    if (!membreId || !uuidValide(roleId)) {
      return reponseErreur(res, "Identifiant de membre ou de rôle invalide.");
    }

    const [{ data: membre, error: erreurMembre }, { data: role, error: erreurRole }] =
      await Promise.all([
        supabase.from("membres").select("id").eq("id", membreId).maybeSingle(),
        supabase.from("rf_roles").select("id, nom").eq("id", roleId).maybeSingle()
      ]);

    if (erreurMembre || erreurRole) {
      console.error(erreurMembre || erreurRole);
      return reponseErreur(res, "Impossible de vérifier le membre ou le rôle.", 500);
    }
    if (!membre) return reponseErreur(res, "Membre introuvable.", 404);
    if (!role) return reponseErreur(res, "Rôle introuvable.", 404);

    const { data, error } = await supabase
      .from("rf_membre_roles")
      .upsert(
        { membre_id: String(membreId), role_id: roleId },
        { onConflict: "membre_id" }
      )
      .select("membre_id, role_id, date_attribution")
      .single();

    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible d'attribuer le rôle.", 500);
    }

    res.json({ succes: true, message: "Rôle attribué.", attribution: data, role });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Ajouter ou modifier une exception individuelle : autoriser ou refuser.
app.put("/api/membres/:id/permissions", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(req.params.id);
    const permissionId = req.body.permission_id;
    const decision = req.body.decision;

    if (!membreId || !uuidValide(permissionId)) {
      return reponseErreur(res, "Identifiant de membre ou de permission invalide.");
    }
    if (!["autoriser", "refuser"].includes(decision)) {
      return reponseErreur(res, "La décision doit être 'autoriser' ou 'refuser'.");
    }

    const [{ data: membre, error: erreurMembre }, { data: permission, error: erreurPermission }] =
      await Promise.all([
        supabase.from("membres").select("id").eq("id", membreId).maybeSingle(),
        supabase.from("rf_permissions").select("id").eq("id", permissionId).maybeSingle()
      ]);

    if (erreurMembre || erreurPermission) {
      console.error(erreurMembre || erreurPermission);
      return reponseErreur(res, "Impossible de vérifier le membre ou la permission.", 500);
    }
    if (!membre) return reponseErreur(res, "Membre introuvable.", 404);
    if (!permission) return reponseErreur(res, "Permission introuvable.", 404);

    const { data, error } = await supabase
      .from("rf_membre_permissions")
      .upsert(
        {
          membre_id: String(membreId),
          permission_id: permissionId,
          decision,
          attribue_par: idUtilisateur(req)
        },
        { onConflict: "membre_id,permission_id" }
      )
      .select("membre_id, permission_id, decision, attribue_par, date_attribution")
      .single();

    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible d'enregistrer cette décision.", 500);
    }

    res.json({ succes: true, message: "Permission individuelle mise à jour.", exception: data });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// Supprimer une exception individuelle : le membre retrouve le droit de son rôle.
app.delete(
  "/api/membres/:id/permissions/:permissionId",
  exigerAdministrateur,
  async (req, res) => {
    try {
      const membreId = nettoyerTexte(req.params.id);
      const permissionId = req.params.permissionId;

      if (!membreId || !uuidValide(permissionId)) {
        return reponseErreur(res, "Identifiant de membre ou de permission invalide.");
      }

      const { data, error } = await supabase
        .from("rf_membre_permissions")
        .delete()
        .eq("membre_id", String(membreId))
        .eq("permission_id", permissionId)
        .select("membre_id, permission_id")
        .maybeSingle();

      if (error) {
        console.error(error);
        return reponseErreur(res, "Impossible de réinitialiser cette permission.", 500);
      }
      if (!data) return reponseErreur(res, "Aucune exception individuelle à supprimer.", 404);

      res.json({
        succes: true,
        message: "La permission individuelle suit de nouveau les règles du rôle."
      });
    } catch (erreur) {
      console.error(erreur);
      reponseErreur(res, "Erreur serveur.", 500);
    }
  }
);


// ======================================================
// 22 bis. ADMINISTRATEURS MULTIPLES (promotion de membres)
// ======================================================

app.get("/api/administrateurs", exigerAdministrateur, async (req, res) => {
  try {
    const [{ data: comptes, error: e1 }, { data: promus, error: e2 }] =
      await Promise.all([
        supabase.from("administrateurs").select("id, identifiant"),
        supabase.from("rf_membres_administrateurs").select("membre_id")
      ]);
    if (e1 || e2) {
      console.error(e1 || e2);
      return reponseErreur(res, "Impossible de charger les administrateurs.", 500);
    }

    const ids = (promus || []).map(p => p.membre_id);
    let membres = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from("membres").select("id, prenom, nom").in("id", ids);
      if (error) throw error;
      membres = data || [];
    }

    const administrateurs = [
      ...(comptes || []).map(c => ({ type: "compte", nom: c.identifiant })),
      ...membres.map(m => ({
        type: "membre", membre_id: m.id, nom: `${m.prenom} ${m.nom}`
      }))
    ];
    res.json({ succes: true, administrateurs });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

app.put("/api/membres/:id/administrateur", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(req.params.id);
    const { data: membre, error: e1 } = await supabase
      .from("membres").select("id").eq("id", membreId).maybeSingle();
    if (e1) throw e1;
    if (!membre) return reponseErreur(res, "Membre introuvable.", 404);

    const { error } = await supabase
      .from("rf_membres_administrateurs")
      .upsert(
        { membre_id: String(membreId), promu_par: idUtilisateur(req) },
        { onConflict: "membre_id" }
      );
    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible de promouvoir ce membre.", 500);
    }
    res.json({ succes: true, message: "Membre promu administrateur." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

app.delete("/api/membres/:id/administrateur", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(req.params.id);

    // Garde-fou : ne jamais se retrouver sans aucun administrateur.
    const [{ count: nbComptes }, { count: nbPromus }] = await Promise.all([
      supabase.from("administrateurs").select("*", { count: "exact", head: true }),
      supabase.from("rf_membres_administrateurs").select("*", { count: "exact", head: true })
    ]);
    if ((nbComptes || 0) + (nbPromus || 0) <= 1) {
      return reponseErreur(res, "Impossible de retirer le dernier administrateur.");
    }

    const { error } = await supabase
      .from("rf_membres_administrateurs").delete().eq("membre_id", String(membreId));
    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible de retirer cet administrateur.", 500);
    }
    res.json({ succes: true, message: "Droits d'administrateur retirés." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// ======================================================
// 22 ter. POINTAGES : PRÉSENCES ET ABSENCES
// ======================================================

const STATUTS_POINTAGE = ["Présent", "Absent"];
const dateValide = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

app.get("/api/pointages", exigerPermission("pointages.gerer"), async (req, res) => {
  try {
    const date = nettoyerTexte(req.query.date);
    const activite = nettoyerTexte(req.query.activite);
    if (!dateValide(date)) return reponseErreur(res, "Date invalide.");

    const { data, error } = await supabase
      .from("rf_pointages")
      .select("membre_id, statut, observation")
      .eq("date_pointage", date)
      .eq("activite", activite);
    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible de charger les pointages.", 500);
    }
    res.json({ succes: true, pointages: data || [] });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

app.put("/api/pointages", exigerPermission("pointages.gerer"), async (req, res) => {
  try {
    const date = nettoyerTexte(req.body.date);
    const activite = nettoyerTexte(req.body.activite).slice(0, 120);
    const lignes = req.body.pointages;

    if (!dateValide(date)) return reponseErreur(res, "Date invalide.");
    if (!Array.isArray(lignes) || !lignes.length || lignes.length > 2000) {
      return reponseErreur(res, "Liste de pointages invalide.");
    }
    if (lignes.some(l => !STATUTS_POINTAGE.includes(l.statut))) {
      return reponseErreur(res, "Statut de présence invalide.");
    }

    const enregistrements = lignes.map(l => ({
      membre_id: String(l.membre_id),
      date_pointage: date,
      activite,
      statut: l.statut,
      observation: nettoyerTexte(l.observation).slice(0, 300) || null,
      enregistre_par: idUtilisateur(req)
    }));

    const { error } = await supabase
      .from("rf_pointages")
      .upsert(enregistrements, { onConflict: "membre_id,date_pointage,activite" });
    if (error) {
      console.error(error);
      return reponseErreur(res, "Impossible d'enregistrer l'appel.", 500);
    }
    res.json({ succes: true, message: "Appel enregistré." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Erreur serveur.", 500);
  }
});

// ======================================================
// 22 quater. SUPERVISIONS : ANALYSE DES PARTICIPATIONS
// ======================================================

app.get("/api/supervisions", exigerUneDes(["supervisions.voir", "rapports.voir"]), async (req, res) => {
  try {
    const debut = nettoyerTexte(req.query.debut);
    const fin = nettoyerTexte(req.query.fin);
    if (!dateValide(debut) || !dateValide(fin) || debut > fin) {
      return reponseErreur(res, "Période invalide.");
    }

    // Lecture par pages de 1000 (limite de Supabase)
    const pointages = [];
    for (let depart = 0; ; depart += 1000) {
      const { data, error } = await supabase
        .from("rf_pointages")
        .select("membre_id, statut, date_pointage, activite")
        .gte("date_pointage", debut)
        .lte("date_pointage", fin)
        .range(depart, depart + 999);
      if (error) throw error;
      pointages.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const { data: membres, error: erreurMembres } = await supabase
      .from("membres").select("id, prenom, nom");
    if (erreurMembres) throw erreurMembres;

    const noms = new Map((membres || []).map(m => [String(m.id), `${m.prenom} ${m.nom}`]));
    const parMembre = new Map();
    const seances = new Set();

    for (const p of pointages) {
      seances.add(`${p.date_pointage}|${p.activite}`);
      const cle = String(p.membre_id);
      if (!parMembre.has(cle)) {
        parMembre.set(cle, {
          membre_id: cle, nom: noms.get(cle) || "Membre supprimé",
          present: 0, retard: 0, excuse: 0, absent: 0
        });
      }
      const ligne = parMembre.get(cle);
      if (p.statut === "Présent") ligne.present++;
      else if (p.statut === "Retard") ligne.retard++;
      else if (p.statut === "Excusé") ligne.excuse++;
      else if (p.statut === "Absent") ligne.absent++;
    }

    const taux = l => {
      const base = l.present + l.retard + l.absent;
      return base ? Math.round(((l.present + l.retard) / base) * 100) : null;
    };

    const liste = [...parMembre.values()].map(l => ({ ...l, taux: taux(l) }))
      .sort((a, b) => (a.taux ?? 101) - (b.taux ?? 101) || b.absent - a.absent);

    const totaux = liste.reduce((t, l) => {
      t.present += l.present; t.retard += l.retard;
      t.excuse += l.excuse; t.absent += l.absent;
      return t;
    }, { present: 0, retard: 0, excuse: 0, absent: 0 });
    totaux.seances = seances.size;
    totaux.taux = taux(totaux);

    res.json({ succes: true, totaux, membres: liste });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger la supervision.", 500);
  }
});

// ======================================================
// 22 quinquies. RÉUNIONS : CONVOCATIONS, PARTICIPANTS, PROCÈS-VERBAUX
// ======================================================

const STATUTS_REUNION = ["Prévue", "Tenue", "Annulée"];
const PRESENCES_REUNION = ["Présent", "Excusé", "Absent"];

function lireReunion(corps) {
  const titre = nettoyerTexte(corps.titre).slice(0, 150);
  const date = nettoyerTexte(corps.date_reunion);
  const statut = STATUTS_REUNION.includes(corps.statut) ? corps.statut : "Prévue";
  if (!titre || !dateValide(date)) return null;
  return {
    titre,
    date_reunion: date,
    heure: nettoyerTexte(corps.heure).slice(0, 5) || null,
    lieu: nettoyerTexte(corps.lieu).slice(0, 150) || null,
    ordre_du_jour: nettoyerTexte(corps.ordre_du_jour).slice(0, 5000) || null,
    proces_verbal: nettoyerTexte(corps.proces_verbal).slice(0, 20000) || null,
    statut
  };
}

function lireParticipants(liste) {
  if (!Array.isArray(liste) || liste.length > 2000) return null;
  const vus = new Map();
  for (const p of liste) {
    const presence = PRESENCES_REUNION.includes(p.presence) ? p.presence : "Présent";
    vus.set(String(p.membre_id), presence);
  }
  return [...vus].map(([membre_id, presence]) => ({ membre_id, presence }));
}

async function remplacerParticipants(reunionId, participants) {
  const { error: e1 } = await supabase
    .from("rf_reunion_participants").delete().eq("reunion_id", reunionId);
  if (e1) throw e1;
  if (!participants.length) return;
  const { error: e2 } = await supabase
    .from("rf_reunion_participants")
    .insert(participants.map(p => ({ reunion_id: reunionId, ...p })));
  if (e2) throw e2;
}

app.get("/api/reunions", exigerUneDes(["reunions.voir", "reunions.gerer"]), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rf_reunions")
      .select("id, titre, date_reunion, heure, lieu, statut")
      .order("date_reunion", { ascending: false });
    if (error) throw error;

    const reunions = data || [];
    const effectifs = new Map(reunions.map(r => [r.id, { presents: 0, absents: 0, excuses: 0 }]));
    const ids = reunions.map(r => r.id);

    for (let i = 0; i < ids.length; i += 100) {
      const lot = ids.slice(i, i + 100);
      for (let depart = 0; ; depart += 1000) {
        const { data: parts, error: erreurParts } = await supabase
          .from("rf_reunion_participants")
          .select("reunion_id, presence")
          .in("reunion_id", lot)
          .range(depart, depart + 999);
        if (erreurParts) throw erreurParts;
        (parts || []).forEach(p => {
          const e = effectifs.get(p.reunion_id);
          if (!e) return;
          if (p.presence === "Absent") e.absents++;
          else if (p.presence === "Excusé") e.excuses++;
          else e.presents++;
        });
        if (!parts || parts.length < 1000) break;
      }
    }

    res.json({
      succes: true,
      reunions: reunions.map(r => ({ ...r, ...effectifs.get(r.id) }))
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les réunions.", 500);
  }
});

app.get("/api/reunions/:id", exigerUneDes(["reunions.voir", "reunions.gerer"]), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const [{ data: reunion, error: e1 }, { data: participants, error: e2 }] =
      await Promise.all([
        supabase.from("rf_reunions").select("*").eq("id", req.params.id).maybeSingle(),
        supabase.from("rf_reunion_participants")
          .select("membre_id, presence").eq("reunion_id", req.params.id)
      ]);
    if (e1 || e2) throw e1 || e2;
    if (!reunion) return reponseErreur(res, "Réunion introuvable.", 404);
    res.json({ succes: true, reunion, participants: participants || [] });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger la réunion.", 500);
  }
});

app.post("/api/reunions", exigerPermission("reunions.gerer"), async (req, res) => {
  try {
    const reunion = lireReunion(req.body);
    const participants = lireParticipants(req.body.participants);
    if (!reunion || !participants) return reponseErreur(res, "Titre, date ou participants invalides.");

    const { data, error } = await supabase
      .from("rf_reunions")
      .insert({ ...reunion, cree_par: idUtilisateur(req) })
      .select("id").single();
    if (error) throw error;

    await remplacerParticipants(data.id, participants);
    res.status(201).json({ succes: true, message: "Réunion enregistrée.", id: data.id });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer la réunion.", 500);
  }
});

app.put("/api/reunions/:id", exigerPermission("reunions.gerer"), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const reunion = lireReunion(req.body);
    const participants = lireParticipants(req.body.participants);
    if (!reunion || !participants) return reponseErreur(res, "Titre, date ou participants invalides.");

    const { data, error } = await supabase
      .from("rf_reunions").update(reunion).eq("id", req.params.id)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) return reponseErreur(res, "Réunion introuvable.", 404);

    await remplacerParticipants(req.params.id, participants);
    res.json({ succes: true, message: "Réunion mise à jour." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de modifier la réunion.", 500);
  }
});

app.delete("/api/reunions/:id", exigerPermission("reunions.gerer"), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const { error } = await supabase.from("rf_reunions").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ succes: true, message: "Réunion supprimée." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de supprimer la réunion.", 500);
  }
});

// ======================================================
// 22 sexies. PROGRAMME : CATÉGORIES CONCERNÉES PAR ACTIVITÉ
// ======================================================

const CATEGORIES_PROGRAMME = ["hommes", "femmes", "enfants", "jeunes", "adultes", "bureau"];

app.get("/api/programme-categories", exigerUneDes(["programme.voir", "programme.gerer", "pointages.gerer"]), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rf_programme_categories").select("programme_id, categorie");
    if (error) throw error;
    res.json({ succes: true, liens: data || [] });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les catégories du programme.", 500);
  }
});

app.put("/api/programme/:id/categories", exigerPermission("programme.gerer"), async (req, res) => {
  try {
    const programmeId = nettoyerTexte(req.params.id);
    const categories = req.body.categories;
    if (!programmeId || programmeId.length > 60) return reponseErreur(res, "Activité invalide.");
    if (!Array.isArray(categories) || categories.some(c => !CATEGORIES_PROGRAMME.includes(c))) {
      return reponseErreur(res, "Catégories invalides.");
    }

    const { error: e1 } = await supabase
      .from("rf_programme_categories").delete().eq("programme_id", programmeId);
    if (e1) throw e1;

    const uniques = [...new Set(categories)];
    if (uniques.length) {
      const { error: e2 } = await supabase
        .from("rf_programme_categories")
        .insert(uniques.map(categorie => ({ programme_id: programmeId, categorie })));
      if (e2) throw e2;
    }
    res.json({ succes: true, message: "Catégories enregistrées." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer les catégories.", 500);
  }
});

// ======================================================
// 22 septies. PERMISSIONS PAR FONCTION DU BUREAU
// ======================================================

app.get("/api/fonctions-permissions", exigerAdministrateur, async (req, res) => {
  try {
    const [{ data: liens, error: e1 }, { data: postes, error: e2 }] = await Promise.all([
      supabase.from("rf_fonction_permissions").select("fonction, permission_id"),
      supabase.from("fonctions_bureau").select("fonction")
    ]);
    if (e1 || e2) throw e1 || e2;

    const groupes = new Map();
    const ajouter = nom => {
      const cle = normaliserFonction(nom);
      if (cle && !groupes.has(cle)) groupes.set(cle, { fonction: String(nom).trim(), permission_ids: [] });
      return groupes.get(cle);
    };
    (postes || []).forEach(p => ajouter(p.fonction));
    (liens || []).forEach(l => {
      const g = ajouter(l.fonction);
      if (g) g.permission_ids.push(l.permission_id);
    });

    res.json({ succes: true, fonctions: [...groupes.values()] });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les permissions par fonction.", 500);
  }
});

app.put("/api/fonctions-permissions", exigerAdministrateur, async (req, res) => {
  try {
    const fonction = nettoyerTexte(req.body.fonction).slice(0, 100);
    const ids = req.body.permission_ids;
    if (!fonction) return reponseErreur(res, "Fonction invalide.");
    if (!Array.isArray(ids) || ids.length > 500) return reponseErreur(res, "Permissions invalides.");

    const uniques = [...new Set(ids)];
    if (uniques.length) {
      const { data: existantes, error } = await supabase
        .from("rf_permissions").select("id").in("id", uniques);
      if (error) throw error;
      if ((existantes || []).length !== uniques.length) {
        return reponseErreur(res, "Permission inconnue.");
      }
    }

    const { data: anciennes, error: e1 } = await supabase
      .from("rf_fonction_permissions").select("fonction");
    if (e1) throw e1;
    const noms = [...new Set((anciennes || [])
      .filter(l => normaliserFonction(l.fonction) === normaliserFonction(fonction))
      .map(l => l.fonction))];
    if (noms.length) {
      const { error } = await supabase
        .from("rf_fonction_permissions").delete().in("fonction", noms);
      if (error) throw error;
    }

    if (uniques.length) {
      const { error } = await supabase
        .from("rf_fonction_permissions")
        .insert(uniques.map(permission_id => ({ fonction, permission_id })));
      if (error) throw error;
    }
    res.json({ succes: true, message: "Permissions de la fonction enregistrées." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer les permissions.", 500);
  }
});

// ======================================================
// 22 octies. INFORMATIONS HEBDOMADAIRES DES ACTIVITÉS
// ======================================================

app.get("/api/pointage-infos", exigerPermission("pointages.gerer"), async (req, res) => {
  try {
    const date = nettoyerTexte(req.query.date);
    const activite = nettoyerTexte(req.query.activite);
    if (!dateValide(date)) return reponseErreur(res, "Date invalide.");

    const [{ data: info, error: e1 }, { data: precedente, error: e2 }] = await Promise.all([
      supabase.from("rf_pointage_infos").select("lieu, informations, date_maj")
        .eq("date_pointage", date).eq("activite", activite).maybeSingle(),
      supabase.from("rf_pointage_infos").select("date_pointage, lieu, informations")
        .eq("activite", activite).lt("date_pointage", date)
        .order("date_pointage", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (e1 || e2) throw e1 || e2;
    res.json({ succes: true, info: info || null, precedente: precedente || null });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les informations.", 500);
  }
});

app.put("/api/pointage-infos", exigerPermission("pointages.gerer"), async (req, res) => {
  try {
    const date = nettoyerTexte(req.body.date);
    const activite = nettoyerTexte(req.body.activite).slice(0, 120);
    if (!dateValide(date)) return reponseErreur(res, "Date invalide.");

    const { error } = await supabase.from("rf_pointage_infos").upsert({
      date_pointage: date,
      activite,
      lieu: nettoyerTexte(req.body.lieu).slice(0, 150) || null,
      informations: nettoyerTexte(req.body.informations).slice(0, 5000) || null,
      mis_a_jour_par: idUtilisateur(req),
      date_maj: new Date().toISOString()
    }, { onConflict: "date_pointage,activite" });
    if (error) throw error;
    res.json({ succes: true, message: "Informations enregistrées." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer les informations.", 500);
  }
});

// ======================================================
// 22 nonies. UTILISATEUR CONNECTÉ (profil dans le menu)
// ======================================================

app.get("/api/moi", exigerMembreConnecte, async (req, res) => {
  try {
    const admin = req.session.administrateur ||
      { identifiant: "", membre_id: req.session.membre.membre_id };
    let prenom = "";
    let nom = "";

    if (admin.membre_id) {
      const { data } = await supabase
        .from("membres").select("prenom, nom").eq("id", admin.membre_id).maybeSingle();
      if (data) { prenom = data.prenom || ""; nom = data.nom || ""; }
    }

    let initiales;
    let affichage;
    if (prenom || nom) {
      initiales = `${prenom.charAt(0)}${nom.charAt(0)}`;
      affichage = `${prenom} ${nom}`.trim();
    } else {
      const mots = String(admin.identifiant || "").trim().split(/\s+/).filter(Boolean);
      initiales = mots.length > 1
        ? `${mots[0].charAt(0)}${mots[1].charAt(0)}`
        : String(mots[0] || "?").slice(0, 2);
      affichage = String(admin.identifiant || "Administrateur");
    }

    res.json({
      succes: true,
      nom_affiche: affichage,
      initiales: initiales.toUpperCase(),
      role: req.session.administrateur ? "Administrateur" : "Membre"
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger le profil.", 500);
  }
});

// ======================================================
// 22 decies. ÉVOLUTION DU TAUX D'ABSENCE PAR PROGRAMME
// ======================================================

app.get("/api/supervisions-evolution", exigerPermission("supervisions.voir"), async (req, res) => {
  try {
    const debut = nettoyerTexte(req.query.debut);
    const fin = nettoyerTexte(req.query.fin);
    if (!dateValide(debut) || !dateValide(fin) || debut > fin) {
      return reponseErreur(res, "Période invalide.");
    }

    const lignes = [];
    for (let depart = 0; ; depart += 1000) {
      const { data, error } = await supabase
        .from("rf_pointages")
        .select("activite, date_pointage, statut")
        .gte("date_pointage", debut)
        .lte("date_pointage", fin)
        .range(depart, depart + 999);
      if (error) throw error;
      lignes.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const parActivite = new Map();
    for (const l of lignes) {
      const present = l.statut === "Présent" || l.statut === "Retard";
      const absent = l.statut === "Absent";
      if (!present && !absent) continue;

      if (!parActivite.has(l.activite)) parActivite.set(l.activite, new Map());
      const jours = parActivite.get(l.activite);
      if (!jours.has(l.date_pointage)) jours.set(l.date_pointage, { present: 0, absent: 0 });
      const jour = jours.get(l.date_pointage);
      if (present) jour.present++; else jour.absent++;
    }

    const series = [...parActivite.entries()].map(([activite, jours]) => ({
      activite: activite || "Appel libre",
      points: [...jours.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
          date,
          absents: v.absent,
          total: v.present + v.absent,
          taux: Math.round((v.absent / (v.present + v.absent)) * 100)
        }))
    })).sort((a, b) => a.activite.localeCompare(b.activite, "fr"));

    res.json({ succes: true, series });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger l'évolution des absences.", 500);
  }
});

// ======================================================
// 22 undecies. PERMISSIONS DE L'UTILISATEUR CONNECTÉ
// ======================================================

app.get("/api/mes-permissions", exigerMembreConnecte, async (req, res) => {
  try {
    res.json({
      succes: true,
      administrateur: Boolean(req.session.administrateur),
      permissions: await permissionsUtilisateur(req)
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger vos permissions.", 500);
  }
});

// ======================================================
// 22 duodecies. GESTION DES COMPTES (administrateurs seulement)
// ======================================================

const TYPES_COMPTE = { administrateur: "administrateurs", membre: "comptes_membres" };

async function compterAdministrateurs() {
  const [{ count: a }, { count: b }] = await Promise.all([
    supabase.from("administrateurs").select("*", { count: "exact", head: true }),
    supabase.from("rf_membres_administrateurs").select("*", { count: "exact", head: true })
  ]);
  return (a || 0) + (b || 0);
}

app.get("/api/comptes", exigerAdministrateur, async (req, res) => {
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from("administrateurs").select("id, identifiant"),
      supabase.from("comptes_membres").select("id, membre_id, actif, compte_verifie"),
      supabase.from("membres").select("id, prenom, nom"),
      supabase.from("rf_membres_administrateurs").select("membre_id")
    ]);
    const erreur = r1.error || r2.error || r3.error || r4.error;
    if (erreur) throw erreur;

    const membres = new Map((r3.data || []).map(m => [String(m.id), m]));
    const promus = new Set((r4.data || []).map(p => String(p.membre_id)));
    const avecCompte = new Set((r2.data || []).map(c => String(c.membre_id)));
    const nomDe = id => {
      const m = membres.get(String(id));
      return m ? `${m.prenom} ${m.nom}` : "Membre supprimé";
    };

    res.json({
      succes: true,
      moi: req.session.administrateur.id,
      administrateurs: r1.data || [],
      comptes: (r2.data || []).map(c => ({
        id: c.id,
        membre_id: c.membre_id,
        nom: nomDe(c.membre_id),
        actif: c.actif === true,
        administrateur: promus.has(String(c.membre_id))
      })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
      sans_compte: (r3.data || [])
        .filter(m => !avecCompte.has(String(m.id)))
        .sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr"))
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les comptes.", 500);
  }
});

app.post("/api/comptes/administrateur", exigerAdministrateur, async (req, res) => {
  try {
    const identifiant = nettoyerTexte(req.body.identifiant).slice(0, 60);
    const motDePasse = typeof req.body.mot_de_passe === "string" ? req.body.mot_de_passe : "";
    if (identifiant.length < 3) return reponseErreur(res, "L'identifiant doit contenir au moins 3 caractères.");
    if (motDePasse.length < 10) return reponseErreur(res, "Le mot de passe doit contenir au moins 10 caractères.");

    const { data: existant, error: e1 } = await supabase
      .from("administrateurs").select("id").eq("identifiant", identifiant).maybeSingle();
    if (e1) throw e1;
    if (existant) return reponseErreur(res, "Cet identifiant existe déjà.");

    const { error } = await supabase.from("administrateurs")
      .insert({ identifiant, mot_de_passe_hash: await bcrypt.hash(motDePasse, 12) });
    if (error) throw error;
    res.status(201).json({ succes: true, message: "Compte administrateur créé." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de créer le compte.", 500);
  }
});

app.post("/api/comptes/membre", exigerAdministrateur, async (req, res) => {
  try {
    const membreId = nettoyerTexte(String(req.body.membre_id ?? ""));
    const motDePasse = typeof req.body.mot_de_passe === "string" ? req.body.mot_de_passe : "";
    if (!membreId) return reponseErreur(res, "Membre invalide.");
    if (motDePasse.length < 8) return reponseErreur(res, "Le mot de passe doit contenir au moins 8 caractères.");

    const { data: membre, error: e1 } = await supabase
      .from("membres").select("id").eq("id", membreId).maybeSingle();
    if (e1) throw e1;
    if (!membre) return reponseErreur(res, "Membre introuvable.", 404);

    const { data: existant, error: e2 } = await supabase
      .from("comptes_membres").select("id").eq("membre_id", membre.id).maybeSingle();
    if (e2) throw e2;
    if (existant) return reponseErreur(res, "Ce membre a déjà un compte.");

    const { error } = await supabase.from("comptes_membres").insert({
      membre_id: membre.id,
      mot_de_passe_hash: await bcrypt.hash(motDePasse, 12),
      compte_verifie: true,
      actif: true
    });
    if (error) throw error;
    res.status(201).json({ succes: true, message: "Compte créé." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de créer le compte.", 500);
  }
});

app.put("/api/comptes/:type/:id/mot-de-passe", exigerAdministrateur, async (req, res) => {
  try {
    const table = TYPES_COMPTE[req.params.type];
    if (!table) return reponseErreur(res, "Type de compte invalide.");
    const minimum = req.params.type === "administrateur" ? 10 : 8;
    const motDePasse = typeof req.body.mot_de_passe === "string" ? req.body.mot_de_passe : "";
    if (motDePasse.length < minimum) {
      return reponseErreur(res, `Le mot de passe doit contenir au moins ${minimum} caractères.`);
    }

    const { data, error } = await supabase.from(table)
      .update({ mot_de_passe_hash: await bcrypt.hash(motDePasse, 12) })
      .eq("id", req.params.id).select("id");
    if (error) throw error;
    if (!data || data.length !== 1) return reponseErreur(res, "Compte introuvable.", 404);
    res.json({ succes: true, message: "Mot de passe modifié." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de modifier le mot de passe.", 500);
  }
});

app.put("/api/comptes/membre/:id/statut", exigerAdministrateur, async (req, res) => {
  try {
    if (typeof req.body.actif !== "boolean") return reponseErreur(res, "Statut invalide.");
    const { data, error } = await supabase.from("comptes_membres")
      .update({ actif: req.body.actif }).eq("id", req.params.id).select("id");
    if (error) throw error;
    if (!data || data.length !== 1) return reponseErreur(res, "Compte introuvable.", 404);
    res.json({ succes: true, message: req.body.actif ? "Compte activé." : "Compte désactivé." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de modifier le compte.", 500);
  }
});

app.delete("/api/comptes/:type/:id", exigerAdministrateur, async (req, res) => {
  try {
    const table = TYPES_COMPTE[req.params.type];
    if (!table) return reponseErreur(res, "Type de compte invalide.");

    if (req.params.type === "administrateur") {
      if (String(req.params.id) === String(req.session.administrateur.id)) {
        return reponseErreur(res, "Vous ne pouvez pas supprimer votre propre compte.");
      }
      if ((await compterAdministrateurs()) <= 1) {
        return reponseErreur(res, "Impossible de supprimer le dernier administrateur.");
      }
    }

    const { data, error } = await supabase.from(table).delete().eq("id", req.params.id).select("id");
    if (error) throw error;
    if (!data || data.length !== 1) return reponseErreur(res, "Compte introuvable.", 404);
    res.json({ succes: true, message: "Compte supprimé." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de supprimer le compte.", 500);
  }
});

// ======================================================
// 22 terdecies. DIAGNOSTIC DES ACCÈS (pour l'utilisateur connecté)
// ======================================================

app.get("/api/diagnostic-acces", exigerMembreConnecte, async (req, res) => {
  try {
    if (!req.session.membre) {
      return res.json({ succes: true, type: "administrateur", message: "Les administrateurs ont tous les droits." });
    }

    const idMembre = String(req.session.membre.membre_id);
    const problemes = [];
    const lire = (nom, resultat) => {
      if (resultat.error) problemes.push(`${nom} : ${resultat.error.message}`);
      return resultat.data || [];
    };

    const [rPerm, rRoles, rPostes, rAncien, rAttrib, rExc, rLiensRole, rLiensFonction] = await Promise.all([
      supabase.from("rf_permissions").select("id, code"),
      supabase.from("rf_roles").select("id, nom"),
      supabase.from("fonctions_bureau").select("fonction").eq("membre_id", idMembre),
      supabase.from("bureau_membres").select("membre_id").eq("membre_id", idMembre),
      supabase.from("rf_membre_roles").select("role_id").eq("membre_id", idMembre),
      supabase.from("rf_membre_permissions").select("permission_id, decision").eq("membre_id", idMembre),
      supabase.from("rf_role_permissions").select("role_id, permission_id"),
      supabase.from("rf_fonction_permissions").select("fonction, permission_id")
    ]);

    const catalogue = lire("rf_permissions", rPerm);
    const roles = lire("rf_roles", rRoles);
    const postes = lire("fonctions_bureau", rPostes);
    const ancien = lire("bureau_membres", rAncien);
    const attrib = lire("rf_membre_roles", rAttrib);
    const exceptions = lire("rf_membre_permissions", rExc);
    const liensRole = lire("rf_role_permissions", rLiensRole);
    const liensFonction = lire("rf_fonction_permissions", rLiensFonction);

    const codeDe = id => (catalogue.find(p => String(p.id) === String(id)) || {}).code || `?${id}`;
    const presents = catalogue.map(p => p.code);
    const roleEffectif = attrib.length ? attrib[0].role_id : await roleParDefaut(idMembre);
    const nomRole = id => (roles.find(r => String(r.id) === String(id)) || {}).nom || null;
    const fonctions = postes.map(p => normaliserFonction(p.fonction));

    let effectives = [];
    try { effectives = await permissionsUtilisateur(req); }
    catch (e) { problemes.push(`calcul des permissions : ${e.message}`); }

    res.json({
      succes: true,
      membre_id: idMembre,
      role_dans_la_session: req.session.membre.role,
      est_dans_fonctions_bureau: postes.length > 0,
      fonctions: postes.map(p => p.fonction),
      est_dans_bureau_membres: ancien.length > 0,
      role_attribue_a_la_main: attrib.length ? nomRole(attrib[0].role_id) : null,
      role_applique: nomRole(roleEffectif),
      noms_des_roles_existants: roles.map(r => r.nom),
      permissions_absentes_du_catalogue: CODES_GESTION.filter(c => !presents.includes(c)),
      permissions_du_role: liensRole.filter(l => String(l.role_id) === String(roleEffectif)).map(l => codeDe(l.permission_id)),
      permissions_de_la_fonction: liensFonction.filter(l => fonctions.includes(normaliserFonction(l.fonction))).map(l => codeDe(l.permission_id)),
      decisions_individuelles: exceptions.map(e => `${codeDe(e.permission_id)} : ${e.decision}`),
      permissions_effectives: effectives,
      problemes
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, `Diagnostic impossible : ${erreur.message}`, 500);
  }
});

// ======================================================
// 22 quindecies. IMPORT DE MEMBRES (fichier Excel lu par le navigateur)
// ======================================================

app.post("/api/membres/import", exigerPermission("membres.inscrire"), async (req, res) => {
  try {
    const lignes = req.body.membres;
    if (!Array.isArray(lignes) || !lignes.length) return reponseErreur(res, "Aucun membre à importer.");
    if (lignes.length > 1000) return reponseErreur(res, "Maximum 1000 membres par importation.");

    const { data: existants, error: erreurLecture } = await supabase
      .from("membres").select("prenom, nom, telephone, email, date_naissance");
    if (erreurLecture) throw erreurLecture;

    const telephones = new Set();
    const emails = new Set();
    const identites = new Set();
    const identite = (p, n, d) =>
      `${normaliserTexte(p)}|${normaliserTexte(n)}|${String(d || "").slice(0, 10)}`;

    (existants || []).forEach(m => {
      if (m.telephone) telephones.add(normaliserTelephone(m.telephone));
      if (m.email) emails.add(normaliserEmail(m.email));
      identites.add(identite(m.prenom, m.nom, m.date_naissance));
    });

    const ignores = [];
    const aInserer = [];

    for (const l of lignes) {
      const ligne = Number(l.ligne) || 0;
      const refuser = raison => ignores.push({ ligne, raison });

      const prenom = nettoyerTexte(l.prenom).slice(0, 100);
      const nom = nettoyerTexte(l.nom).slice(0, 100);
      const sexe = nettoyerTexte(l.sexe);
      const dateNaissance = nettoyerTexte(l.date_naissance);
      const telephone = normaliserTelephone(l.telephone);
      const email = normaliserEmail(l.email);

      if (!prenom || !nom) { refuser("prénom ou nom manquant"); continue; }
      if (sexe !== "Masculin" && sexe !== "Féminin") { refuser("sexe invalide"); continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance) || Number.isNaN(Date.parse(dateNaissance))) {
        refuser("date de naissance invalide"); continue;
      }
      const naissance = new Date(`${dateNaissance}T00:00:00`);
      if (naissance > new Date() || naissance.getFullYear() < 1900) {
        refuser("date de naissance impossible"); continue;
      }
      if (!telephone && !email) { refuser("téléphone ou e-mail nécessaire"); continue; }
      if (telephone && !telephoneValide(telephone)) { refuser("téléphone : 9 chiffres attendus"); continue; }
      if (email && !emailValide(email)) { refuser("e-mail invalide"); continue; }

      if (telephone && telephones.has(telephone)) { refuser("téléphone déjà enregistré"); continue; }
      if (email && emails.has(email)) { refuser("e-mail déjà enregistré"); continue; }
      if (identites.has(identite(prenom, nom, dateNaissance))) { refuser("membre déjà enregistré"); continue; }

      const aujourdHui = new Date();
      let age = aujourdHui.getFullYear() - naissance.getFullYear();
      if (aujourdHui.getMonth() < naissance.getMonth() ||
          (aujourdHui.getMonth() === naissance.getMonth() && aujourdHui.getDate() < naissance.getDate())) {
        age--;
      }
      const categorie = age < 25 ? "Cadets" : (sexe === "Masculin" ? "Hommes" : "Femmes");

      if (telephone) telephones.add(telephone);
      if (email) emails.add(email);
      identites.add(identite(prenom, nom, dateNaissance));

      aInserer.push({
        prenom, nom, sexe, categorie,
        telephone: telephone || null,
        email: email || null,
        date_naissance: dateNaissance,
        profession: nettoyerTexte(l.profession).slice(0, 100) || null
      });
    }

    let importes = 0;
    for (let i = 0; i < aInserer.length; i += 200) {
      const lot = aInserer.slice(i, i + 200);
      const { error } = await supabase.from("membres").insert(lot);
      if (error) {
        console.error(error);
        return res.status(500).json({
          succes: false,
          message: `L'importation s'est arrêtée : ${importes} membre(s) déjà enregistré(s) avant l'erreur.`
        });
      }
      importes += lot.length;
    }

    res.status(201).json({
      succes: true,
      importes,
      ignores,
      message: `${importes} membre(s) importé(s).`
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'importer ce fichier.", 500);
  }
});

// ======================================================
// 22 sexdecies. MEMBRES INACTIFS (plus de 5 absences à une même activité)
// ======================================================

const SEUIL_INACTIF = 5;

app.get("/api/membres-inactifs", exigerUneDes(["membres.voir", "supervisions.voir", "pointages.gerer"]), async (req, res) => {
  try {
    const absences = new Map();
    for (let depart = 0; ; depart += 1000) {
      const { data, error } = await supabase
        .from("rf_pointages")
        .select("membre_id, activite")
        .eq("statut", "Absent")
        .neq("activite", "")
        .range(depart, depart + 999);
      if (error) throw error;
      (data || []).forEach(l => {
        const cle = `${l.membre_id}|${l.activite}`;
        absences.set(cle, (absences.get(cle) || 0) + 1);
      });
      if (!data || data.length < 1000) break;
    }

    const parMembre = new Map();
    for (const [cle, n] of absences) {
      if (n <= SEUIL_INACTIF) continue;
      const [membreId, ...reste] = cle.split("|");
      if (!parMembre.has(membreId)) parMembre.set(membreId, []);
      parMembre.get(membreId).push({ activite: reste.join("|"), absences: n });
    }

    const ids = [...parMembre.keys()];
    const noms = new Map();
    if (ids.length) {
      const { data: membres, error } = await supabase
        .from("membres").select("id, prenom, nom").in("id", ids);
      if (error) throw error;
      (membres || []).forEach(m => noms.set(String(m.id), `${m.prenom} ${m.nom}`));
    }

    const inactifs = ids
      .filter(id => noms.has(id))
      .map(id => ({
        membre_id: id,
        nom: noms.get(id),
        activites: parMembre.get(id).sort((a, b) => b.absences - a.absences),
        total: parMembre.get(id).reduce((t, a) => t + a.absences, 0)
      }))
      .sort((a, b) => b.total - a.total);

    res.json({ succes: true, seuil: SEUIL_INACTIF, inactifs });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de calculer les membres inactifs.", 500);
  }
});

// ======================================================
// 22 septendecies. COURS : NIVEAUX, ÉVALUATIONS ET NOTES (sur 20)
// ======================================================

const NIVEAUX_COURS = ["Rawda", "Section 1", "Section 2", "Section 3"];
const LIRE_COURS = ["cours.voir", "cours.gerer"];

function ageDepuis(dateNaissance) {
  const n = new Date(dateNaissance);
  if (!dateNaissance || Number.isNaN(n.getTime())) return null;
  const auj = new Date();
  let age = auj.getFullYear() - n.getFullYear();
  if (auj < new Date(auj.getFullYear(), n.getMonth(), n.getDate())) age--;
  return age;
}

function niveauPourAge(age, niveaux) {
  if (age === null) return null;
  const n = niveaux.find(x => age >= x.age_min && age <= x.age_max);
  return n ? n.nom : null;
}

async function lireNiveaux() {
  const { data, error } = await supabase.from("rf_niveaux").select("*").order("ordre", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function lireNotes(idsEvaluations) {
  const notes = [];
  for (let i = 0; i < idsEvaluations.length; i += 100) {
    const lot = idsEvaluations.slice(i, i + 100);
    for (let depart = 0; ; depart += 1000) {
      const { data, error } = await supabase.from("rf_notes")
        .select("evaluation_id, membre_id, note").in("evaluation_id", lot)
        .range(depart, depart + 999);
      if (error) throw error;
      notes.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return notes;
}

function statsNotes(valeurs) {
  if (!valeurs.length) return { moyenne: null, reussite: null };
  const somme = valeurs.reduce((t, v) => t + v, 0);
  return {
    moyenne: Math.round((somme / valeurs.length) * 100) / 100,
    reussite: Math.round((valeurs.filter(v => v >= 10).length / valeurs.length) * 100)
  };
}

app.get("/api/niveaux", exigerUneDes([...LIRE_COURS, "pointages.gerer", "rapports.voir"]), async (req, res) => {
  try {
    res.json({ succes: true, niveaux: await lireNiveaux() });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les niveaux.", 500);
  }
});

app.put("/api/niveaux", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    const liste = req.body.niveaux;
    if (!Array.isArray(liste) || !liste.length) return reponseErreur(res, "Niveaux invalides.");

    const propres = [];
    for (const n of liste) {
      const min = Number(n.age_min);
      const max = Number(n.age_max);
      if (!NIVEAUX_COURS.includes(n.nom) || !Number.isInteger(min) || !Number.isInteger(max)
          || min < 0 || max > 120 || min > max) {
        return reponseErreur(res, `Tranche d'âge invalide pour « ${nettoyerTexte(n.nom)} ».`);
      }
      propres.push({ nom: n.nom, age_min: min, age_max: max });
    }
    for (let i = 0; i < propres.length; i++) {
      for (let j = i + 1; j < propres.length; j++) {
        if (propres[i].age_min <= propres[j].age_max && propres[j].age_min <= propres[i].age_max) {
          return reponseErreur(res, `Les tranches d'âge de « ${propres[i].nom} » et « ${propres[j].nom} » se chevauchent.`);
        }
      }
    }
    for (const n of propres) {
      const { error } = await supabase.from("rf_niveaux")
        .update({ age_min: n.age_min, age_max: n.age_max }).eq("nom", n.nom);
      if (error) throw error;
    }
    res.json({ succes: true, message: "Tranches d'âge enregistrées." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer les tranches d'âge.", 500);
  }
});

app.get("/api/cours", exigerUneDes([...LIRE_COURS, "pointages.gerer", "rapports.voir"]), async (req, res) => {
  try {
    const { data, error } = await supabase.from("rf_programme_cours").select("programme_id");
    if (error) throw error;
    res.json({ succes: true, cours: data || [] });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les cours.", 500);
  }
});

app.put("/api/cours/:programmeId", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    const id = nettoyerTexte(req.params.programmeId);
    const { data: activite, error: e1 } = await supabase
      .from("programmes_hebdomadaires").select("id").eq("id", id).maybeSingle();
    if (e1) throw e1;
    if (!activite) return reponseErreur(res, "Activité introuvable.", 404);

    const { error } = await supabase.from("rf_programme_cours")
      .upsert({ programme_id: String(activite.id) }, { onConflict: "programme_id" });
    if (error) throw error;
    res.json({ succes: true, message: "Cours ajouté." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'ajouter le cours.", 500);
  }
});

app.delete("/api/cours/:programmeId", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    const id = nettoyerTexte(req.params.programmeId);
    const { error: e1 } = await supabase.from("rf_evaluations").delete().eq("programme_id", id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("rf_programme_cours").delete().eq("programme_id", id);
    if (e2) throw e2;
    res.json({ succes: true, message: "Cours retiré." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de retirer le cours.", 500);
  }
});

app.get("/api/evaluations", exigerUneDes(LIRE_COURS), async (req, res) => {
  try {
    const programmeId = nettoyerTexte(req.query.programme_id);
    const niveau = nettoyerTexte(req.query.niveau);
    if (!programmeId || !NIVEAUX_COURS.includes(niveau)) return reponseErreur(res, "Paramètres invalides.");

    const { data, error } = await supabase.from("rf_evaluations").select("*")
      .eq("programme_id", programmeId).eq("niveau", niveau)
      .order("date_evaluation", { ascending: false });
    if (error) throw error;

    const evaluations = data || [];
    const notes = await lireNotes(evaluations.map(e => e.id));
    res.json({
      succes: true,
      evaluations: evaluations.map(e => {
        const valeurs = notes.filter(n => n.evaluation_id === e.id).map(n => Number(n.note));
        return {
          ...e,
          nb_notes: valeurs.length,
          ...statsNotes(valeurs),
          notes: notes.filter(n => n.evaluation_id === e.id)
            .map(n => ({ membre_id: n.membre_id, note: Number(n.note) }))
        };
      })
    });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger les évaluations.", 500);
  }
});

app.post("/api/evaluations", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    const programmeId = nettoyerTexte(req.body.programme_id);
    const niveau = nettoyerTexte(req.body.niveau);
    const titre = nettoyerTexte(req.body.titre).slice(0, 150);
    const date = nettoyerTexte(req.body.date_evaluation);
    if (!programmeId || !NIVEAUX_COURS.includes(niveau) || !titre || !dateValide(date)) {
      return reponseErreur(res, "Titre, niveau ou date invalide.");
    }
    const { data: cours, error: e1 } = await supabase
      .from("rf_programme_cours").select("programme_id").eq("programme_id", programmeId).maybeSingle();
    if (e1) throw e1;
    if (!cours) return reponseErreur(res, "Cette activité n'est pas un cours.");

    const { error } = await supabase.from("rf_evaluations").insert({
      programme_id: programmeId, niveau, titre, date_evaluation: date, cree_par: idUtilisateur(req)
    });
    if (error) throw error;
    res.status(201).json({ succes: true, message: "Évaluation créée." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de créer l'évaluation.", 500);
  }
});

app.get("/api/evaluations/:id", exigerUneDes(LIRE_COURS), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const { data: evaluation, error } = await supabase
      .from("rf_evaluations").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!evaluation) return reponseErreur(res, "Évaluation introuvable.", 404);
    const notes = await lireNotes([evaluation.id]);
    res.json({ succes: true, evaluation, notes: notes.map(n => ({ membre_id: n.membre_id, note: Number(n.note) })) });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de charger l'évaluation.", 500);
  }
});

app.delete("/api/evaluations/:id", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const { error } = await supabase.from("rf_evaluations").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ succes: true, message: "Évaluation supprimée." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de supprimer l'évaluation.", 500);
  }
});

app.put("/api/evaluations/:id/notes", exigerPermission("cours.gerer"), async (req, res) => {
  try {
    if (!uuidValide(req.params.id)) return reponseErreur(res, "Identifiant invalide.");
    const liste = req.body.notes;
    if (!Array.isArray(liste) || liste.length > 2000) return reponseErreur(res, "Notes invalides.");

    const aEnregistrer = [];
    const aEffacer = [];
    for (const n of liste) {
      const membreId = String(n.membre_id ?? "");
      if (!membreId) return reponseErreur(res, "Membre invalide.");
      if (n.note === null || n.note === "" || n.note === undefined) { aEffacer.push(membreId); continue; }
      const note = Number(n.note);
      if (!Number.isFinite(note) || note < 0 || note > 20) {
        return reponseErreur(res, "Les notes doivent être comprises entre 0 et 20.");
      }
      aEnregistrer.push({ evaluation_id: req.params.id, membre_id: membreId, note: Math.round(note * 100) / 100 });
    }

    if (aEnregistrer.length) {
      const { error } = await supabase.from("rf_notes")
        .upsert(aEnregistrer, { onConflict: "evaluation_id,membre_id" });
      if (error) throw error;
    }
    if (aEffacer.length) {
      const { error } = await supabase.from("rf_notes")
        .delete().eq("evaluation_id", req.params.id).in("membre_id", aEffacer);
      if (error) throw error;
    }
    res.json({ succes: true, message: "Notes enregistrées." });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible d'enregistrer les notes.", 500);
  }
});

app.get("/api/cours-rapport", exigerUneDes([...LIRE_COURS, "rapports.voir"]), async (req, res) => {
  try {
    const debut = nettoyerTexte(req.query.debut);
    const fin = nettoyerTexte(req.query.fin);
    if (!dateValide(debut) || !dateValide(fin) || debut > fin) return reponseErreur(res, "Période invalide.");

    const { data: liens, error: e1 } = await supabase.from("rf_programme_cours").select("programme_id");
    if (e1) throw e1;
    const ids = (liens || []).map(l => l.programme_id);
    if (!ids.length) return res.json({ succes: true, cours: [] });

    const [rProg, niveaux, rMembres] = await Promise.all([
      supabase.from("programmes_hebdomadaires").select("id, activite, jour").in("id", ids),
      lireNiveaux(),
      supabase.from("membres").select("id, date_naissance")
    ]);
    if (rProg.error) throw rProg.error;
    if (rMembres.error) throw rMembres.error;

    const niveauDuMembre = new Map((rMembres.data || []).map(m =>
      [String(m.id), niveauPourAge(ageDepuis(m.date_naissance), niveaux)]));
    const effectifs = {};
    niveauDuMembre.forEach(n => { if (n) effectifs[n] = (effectifs[n] || 0) + 1; });

    const resultat = [];
    for (const prog of rProg.data || []) {
      const compteurs = {};
      niveaux.forEach(n => { compteurs[n.nom] = { presents: 0, absents: 0 }; });

      for (let depart = 0; ; depart += 1000) {
        const { data, error } = await supabase.from("rf_pointages")
          .select("membre_id, statut").eq("activite", prog.activite)
          .gte("date_pointage", debut).lte("date_pointage", fin)
          .range(depart, depart + 999);
        if (error) throw error;
        (data || []).forEach(p => {
          const n = niveauDuMembre.get(String(p.membre_id));
          if (!n || !compteurs[n]) return;
          if (p.statut === "Absent") compteurs[n].absents++;
          else if (p.statut === "Présent" || p.statut === "Retard") compteurs[n].presents++;
        });
        if (!data || data.length < 1000) break;
      }

      const { data: evals, error: e2 } = await supabase.from("rf_evaluations")
        .select("id, niveau").eq("programme_id", String(prog.id))
        .gte("date_evaluation", debut).lte("date_evaluation", fin);
      if (e2) throw e2;
      const notes = await lireNotes((evals || []).map(e => e.id));

      resultat.push({
        programme_id: prog.id,
        activite: prog.activite,
        jour: prog.jour,
        niveaux: niveaux.map(n => {
          const c = compteurs[n.nom];
          const base = c.presents + c.absents;
          const evalsNiveau = (evals || []).filter(e => e.niveau === n.nom);
          const idsNiveau = new Set(evalsNiveau.map(e => e.id));
          // Moyenne de chaque élève, puis moyenne du niveau = moyenne de ces moyennes
          const parEleve = new Map();
          notes.filter(x => idsNiveau.has(x.evaluation_id)).forEach(x => {
            const cle = String(x.membre_id);
            if (!parEleve.has(cle)) parEleve.set(cle, []);
            parEleve.get(cle).push(Number(x.note));
          });
          const valeurs = [...parEleve.values()].map(v => v.reduce((t, a) => t + a, 0) / v.length);
          return {
            niveau: n.nom,
            effectif: effectifs[n.nom] || 0,
            presence: base ? Math.round((c.presents / base) * 100) : null,
            evaluations: evalsNiveau.length,
            notes: valeurs.length,
            ...statsNotes(valeurs)
          };
        })
      });
    }
    res.json({ succes: true, cours: resultat });
  } catch (erreur) {
    console.error(erreur);
    reponseErreur(res, "Impossible de préparer le rapport des cours.", 500);
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return reponseErreur(res, "Route API introuvable.", 404);
  }

  res.status(404).send("Page introuvable.");
});

// ======================================================
// 23. DÉMARRAGE DU SERVEUR
// ======================================================

app.listen(PORT, () => {
  console.log("-----------------------------------");
  console.log(" REGISTRE FOGNY");
  console.log("-----------------------------------");
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log("TEST : VERSION MODIFIÉE DE SERVER.JS");
});
