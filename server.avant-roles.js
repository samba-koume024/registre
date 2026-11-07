
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

async function verifierPermission(membreId, codePermission) {
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

  // 3. Récupérer le rôle du membre
  const { data: attribution, error: erreurRole } = await supabase
    .from("rf_membre_roles")
    .select("role_id")
    .eq("membre_id", idMembre)
    .maybeSingle();

  if (erreurRole) throw erreurRole;
  if (!attribution) return false;

  // 4. Vérifier la permission du rôle
  const { data: autorisation, error: erreurAutorisation } = await supabase
    .from("rf_role_permissions")
    .select("id")
    .eq("role_id", attribution.role_id)
    .eq("permission_id", permission.id)
    .maybeSingle();

  if (erreurAutorisation) throw erreurAutorisation;

  return Boolean(autorisation);
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
// 7. PAGES HTML ET PROTECTION DES ACCÈS
// ======================================================

app.get("/", (req, res) => {
  if (req.session.administrateur) {
    return res.sendFile(path.join(DOSSIER_PUBLIC, "index.html"));
  }

  if (req.session.membre) {
    if (req.session.membre.role === "bureau") {
      return res.redirect("/bureau.html");
    }

    return res.redirect("/information.html");
  }

  res.redirect("/connexion.html");
});

app.get("/index.html", exigerAdministrateur, (req, res) => {
  res.sendFile(path.join(DOSSIER_PUBLIC, "index.html"));
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


app.post("/api/auth/inscription-membre", async (req, res) => {
    console.log("INSCRIPTION REÇUE !");
    console.log("FICHIER EXÉCUTÉ :", __filename);
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

    const role = await determinerRoleMembre(membre);

    await ouvrirSessionMembre(
      req,
      res,
      membre,
      compte,
      role
    );

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
  exigerBureauOuAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
  exigerAdministrateur,
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
