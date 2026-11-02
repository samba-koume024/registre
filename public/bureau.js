
"use strict";

// ======================================================
// 1. ELEMENTS PRINCIPAUX
// ======================================================

const sections = document.querySelectorAll(".page-section");
const liensNavigation = document.querySelectorAll(
  '.sidebar-nav .nav-link[href^="#"]'
);

const forumContenu = document.getElementById("forum-contenu");
const programmeContenu = document.getElementById("programme-contenu");
const boutonDeconnexion = document.getElementById("bouton-deconnexion");

// ======================================================
// 2. OUTILS
// ======================================================

async function appelerAPI(url, options = {}) {
  const reponse = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let resultat;

  try {
    resultat = await reponse.json();
  } catch {
    throw new Error("Réponse du serveur invalide.");
  }

  if (!reponse.ok) {
    throw new Error(
      resultat.message || resultat.erreur || "Une erreur est survenue."
    );
  }

  return resultat;
}

function creerElement(tag, texte, classe = "") {
  const element = document.createElement(tag);

  if (texte !== undefined && texte !== null) {
    element.textContent = texte;
  }

  if (classe) {
    element.className = classe;
  }

  return element;
}

function afficherMessage(conteneur, message, erreur = false) {
  conteneur.replaceChildren();

  const paragraphe = creerElement(
    "p",
    message,
    erreur ? "message-erreur" : ""
  );

  conteneur.appendChild(paragraphe);
}

// ======================================================
// 3. NAVIGATION
// ======================================================


function afficherSection(id) {
  const sectionExiste = Array.from(sections).some(
    section => section.id === id
  );

  if (!sectionExiste) {
    id = "accueil";
  }

  sections.forEach(section => {
    section.hidden = section.id !== id;
  });

  liensNavigation.forEach(lien => {
    lien.classList.toggle(
      "active",
      lien.getAttribute("href") === `#${id}`
    );
  });

  if (id === "forum") {
    chargerForum();
  }

  if (id === "programme") {
    chargerProgramme();
  }
}

// Navigation dans la barre latérale
liensNavigation.forEach(lien => {
  lien.addEventListener("click", evenement => {
    evenement.preventDefault();

    const id = lien.getAttribute("href").slice(1);

    history.replaceState(null, "", `#${id}`);
    afficherSection(id);
  });
});

// Navigation depuis les cartes du tableau de bord
document.querySelectorAll('.module-card a[href^="#"]').forEach(lien => {
  lien.addEventListener("click", evenement => {
    evenement.preventDefault();

    const id = lien.getAttribute("href").slice(1);

    history.replaceState(null, "", `#${id}`);
    afficherSection(id);
  });
});

// Restaurer la section indiquée dans l'adresse
afficherSection(window.location.hash.slice(1) || "accueil");

// ======================================================
// 4. DECONNEXION
// ======================================================

boutonDeconnexion?.addEventListener("click", async () => {
  boutonDeconnexion.disabled = true;
  boutonDeconnexion.textContent = "Déconnexion...";

  try {
    await appelerAPI("/api/auth/logout", {
      method: "POST"
    });

    window.location.href = "/connexion.html";
  } catch (erreur) {
    alert(erreur.message);
    boutonDeconnexion.disabled = false;
    boutonDeconnexion.textContent = "Se déconnecter";
  }
});

// ======================================================
// 5. FORUM : CHARGEMENT
// ======================================================

let forumEnChargement = false;

async function chargerForum() {
  if (forumEnChargement) return;

  forumEnChargement = true;
  afficherMessage(forumContenu, "Chargement des publications...");

  try {
    const resultat = await appelerAPI("/api/forum/publications");

    afficherForum(resultat.publications || []);
  } catch (erreur) {
    afficherMessage(forumContenu, erreur.message, true);
  } finally {
    forumEnChargement = false;
  }
}

// ======================================================
// 6. FORUM : AFFICHAGE
// ======================================================

function afficherForum(publications) {
  forumContenu.replaceChildren();

  const formulaire = document.createElement("form");
  formulaire.className = "module-card";
  formulaire.style.marginBottom = "25px";

  const titre = creerElement("h3", "Partager une opinion ou observation");
  const description = creerElement(
    "p",
    "Votre publication sera visible par tous les membres du bureau."
  );

  const zoneTexte = document.createElement("textarea");
  zoneTexte.name = "contenu";
  zoneTexte.rows = 5;
  zoneTexte.maxLength = 5000;
  zoneTexte.required = true;
  zoneTexte.placeholder = "Écrivez votre publication ici...";
  zoneTexte.style.width = "100%";
  zoneTexte.style.padding = "12px";
  zoneTexte.style.border = "1px solid #cbd5e1";
  zoneTexte.style.borderRadius = "8px";
  zoneTexte.style.resize = "vertical";
  zoneTexte.style.margin = "15px 0";

  const compteur = creerElement("small", "0 / 5000 caractères");
  compteur.style.display = "block";
  compteur.style.color = "#64748b";

  zoneTexte.addEventListener("input", () => {
    compteur.textContent = `${zoneTexte.value.length} / 5000 caractères`;
  });

  const boutonPublier = creerElement("button", "Publier");
  boutonPublier.type = "submit";
  boutonPublier.style.background = "#15803d";
  boutonPublier.style.color = "white";
  boutonPublier.style.padding = "11px 20px";
  boutonPublier.style.borderRadius = "7px";
  boutonPublier.style.marginTop = "12px";

  const message = document.createElement("p");
  message.setAttribute("role", "status");

  formulaire.append(
    titre,
    description,
    zoneTexte,
    compteur,
    boutonPublier,
    message
  );

  formulaire.addEventListener("submit", async evenement => {
    evenement.preventDefault();

    const contenu = zoneTexte.value.trim();

    if (!contenu) {
      message.textContent = "Veuillez écrire une publication.";
      return;
    }

    boutonPublier.disabled = true;
    boutonPublier.textContent = "Publication...";

    try {
      await appelerAPI("/api/forum/publications", {
        method: "POST",
        body: JSON.stringify({ contenu })
      });

      await chargerForum();
    } catch (erreur) {
      message.textContent = erreur.message;
      boutonPublier.disabled = false;
      boutonPublier.textContent = "Publier";
    }
  });

  const titrePublications = creerElement(
    "h3",
    `Publications du bureau (${publications.length})`
  );

  titrePublications.style.margin = "25px 0 15px";
  forumContenu.append(formulaire, titrePublications);

  if (publications.length === 0) {
    forumContenu.appendChild(
      creerElement(
        "p",
        "Aucune publication pour le moment. Soyez le premier à partager une idée."
      )
    );

    return;
  }

  publications.forEach(publication => {
    const carte = document.createElement("article");
    carte.className = "module-card";
    carte.style.marginBottom = "18px";

    const auteur = creerElement(
      "h3",
      publication.auteur || "Membre du bureau"
    );

    const date = creerElement(
      "small",
      `Publié le ${formaterDate(publication.date_creation)}`
    );

    date.style.color = "#64748b";

    const contenu = creerElement("p", publication.contenu);
    contenu.style.whiteSpace = "pre-wrap";
    contenu.style.lineHeight = "1.7";
    contenu.style.margin = "15px 0";

    carte.append(auteur, date, contenu);

    if (
      publication.date_modification &&
      publication.date_modification !== publication.date_creation
    ) {
      carte.appendChild(
        creerElement("small", "Publication modifiée")
      );
    }

    if (publication.est_auteur) {
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "10px";
      actions.style.flexWrap = "wrap";

      const boutonModifier = creerElement("button", "Modifier");
      boutonModifier.type = "button";
      boutonModifier.style.background = "#2563eb";
      boutonModifier.style.color = "white";
      boutonModifier.style.padding = "9px 14px";
      boutonModifier.style.borderRadius = "6px";

      boutonModifier.addEventListener("click", () => {
        afficherModification(carte, publication);
      });

      const boutonSupprimer = creerElement("button", "Supprimer");
      boutonSupprimer.type = "button";
      boutonSupprimer.style.background = "#dc2626";
      boutonSupprimer.style.color = "white";
      boutonSupprimer.style.padding = "9px 14px";
      boutonSupprimer.style.borderRadius = "6px";

      boutonSupprimer.addEventListener("click", async () => {
        const confirmation = confirm(
          "Voulez-vous vraiment supprimer cette publication ?"
        );

        if (!confirmation) return;

        boutonSupprimer.disabled = true;

        try {
          await appelerAPI(
            `/api/forum/publications/${publication.id}`,
            { method: "DELETE" }
          );

          await chargerForum();
        } catch (erreur) {
          alert(erreur.message);
          boutonSupprimer.disabled = false;
        }
      });

      actions.append(boutonModifier, boutonSupprimer);
      carte.appendChild(actions);
    }

    forumContenu.appendChild(carte);
  });
}

// ======================================================
// 7. FORUM : MODIFICATION
// ======================================================

function afficherModification(carte, publication) {
  carte.replaceChildren();

  const titre = creerElement("h3", "Modifier votre publication");

  const zoneTexte = document.createElement("textarea");
  zoneTexte.value = publication.contenu;
  zoneTexte.maxLength = 5000;
  zoneTexte.rows = 5;
  zoneTexte.style.width = "100%";
  zoneTexte.style.padding = "12px";
  zoneTexte.style.margin = "15px 0";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";

  const enregistrer = creerElement("button", "Enregistrer");
  enregistrer.type = "button";
  enregistrer.style.background = "#15803d";
  enregistrer.style.color = "white";
  enregistrer.style.padding = "10px 15px";

  const annuler = creerElement("button", "Annuler");
  annuler.type = "button";
  annuler.style.background = "#64748b";
  annuler.style.color = "white";
  annuler.style.padding = "10px 15px";

  annuler.addEventListener("click", chargerForum);

  enregistrer.addEventListener("click", async () => {
    const contenu = zoneTexte.value.trim();

    if (!contenu) {
      alert("La publication ne peut pas être vide.");
      return;
    }

    enregistrer.disabled = true;

    try {
      await appelerAPI(
        `/api/forum/publications/${publication.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ contenu })
        }
      );

      await chargerForum();
    } catch (erreur) {
      alert(erreur.message);
      enregistrer.disabled = false;
    }
  });

  actions.append(enregistrer, annuler);
  carte.append(titre, zoneTexte, actions);
}

// ======================================================
// 8. PROGRAMME HEBDOMADAIRE
// ======================================================

let programmeEnChargement = false;

async function chargerProgramme() {
  if (programmeEnChargement) return;

  programmeEnChargement = true;
  afficherMessage(programmeContenu, "Chargement du programme...");

  try {
    const resultat = await appelerAPI("/api/programme");

    afficherProgramme(Array.isArray(resultat) ? resultat : []);
  } catch (erreur) {
    afficherMessage(programmeContenu, erreur.message, true);
  } finally {
    programmeEnChargement = false;
  }
}

// ======================================================
// 9. PROGRAMME : AFFICHAGE PAR JOUR
// ======================================================

function afficherProgramme(programmes) {
  programmeContenu.replaceChildren();

  if (programmes.length === 0) {
    afficherMessage(
      programmeContenu,
      "Aucune activité n'est programmée pour le moment."
    );
    return;
  }

  const jours = [
    "Lundi",
    "Mardi",
    "Mercredi",
    "Jeudi",
    "Vendredi",
    "Samedi",
    "Dimanche"
  ];

  jours.forEach(jour => {
    const activites = programmes.filter(
      programme =>
        String(programme.jour).toLowerCase() === jour.toLowerCase()
    );

    if (activites.length === 0) return;

    const groupe = document.createElement("div");
    groupe.style.marginBottom = "25px";

    const titre = creerElement("h3", jour);
    titre.style.color = "#173b5e";
    titre.style.marginBottom = "12px";

    groupe.appendChild(titre);

    activites.forEach(activite => {
      const carte = document.createElement("article");
      carte.className = "module-card";
      carte.style.marginBottom = "12px";

      carte.appendChild(
        creerElement("h3", activite.activite || "Activité")
      );

      carte.appendChild(
        creerElement(
          "p",
          `${activite.heure_debut || ""} – ${activite.heure_fin || ""}`
        )
      );

      if (activite.lieu) {
        carte.appendChild(
          creerElement("p", `Lieu : ${activite.lieu}`)
        );
      }

      if (activite.observations) {
        carte.appendChild(
          creerElement("p", `Observations : ${activite.observations}`)
        );
      }

      groupe.appendChild(carte);
    });

    programmeContenu.appendChild(groupe);
  });
}

// ======================================================
// 10. FORMATAGE DES DATES
// ======================================================

function formaterDate(date) {
  if (!date) return "Date inconnue";

  const valeur = new Date(date);

  if (Number.isNaN(valeur.getTime())) {
    return "Date inconnue";
  }

  return valeur.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ======================================================
// 11. DEMARRAGE
// ======================================================

const sectionInitiale = window.location.hash.slice(1) || "accueil";

afficherSection(sectionInitiale);
