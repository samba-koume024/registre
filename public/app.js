
const formulaire = document.getElementById("form-membre");
const message = document.getElementById("message");
const bouton = formulaire.querySelector('button[type="submit"]');
const tableau = document.getElementById("liste-membres");
const recherche = document.getElementById("recherche");
const boutonExport = document.getElementById("exporter-excel");

let tousLesMembres = [];
let membresFiltres = [];
let pageCourante = 1;
const membresParPage = 5;
window.graphiqueSexe = null;

// Afficher une cellule du tableau
function celluleTexte(valeur) {
    const cellule = document.createElement("td");
    cellule.textContent = valeur ?? "";
    return cellule;
}

// Calculer et afficher les statistiques
function actualiserStatistiques() {
    const total = tousLesMembres.length;

    const hommes = tousLesMembres.filter(
        membre => membre.sexe === "Masculin"
    ).length;

    const femmes = tousLesMembres.filter(
        membre => membre.sexe === "Féminin"
    ).length;

    const maintenant = new Date();
    const annee = maintenant.getFullYear();
    const mois = maintenant.getMonth() + 1;

    const inscriptionsMois = tousLesMembres.filter(membre => {
        if (!membre.date_inscription) return false;

        const date = membre.date_inscription.slice(0, 10);
        const [a, m] = date.split("-").map(Number);

        return a === annee && m === mois;
    }).length;

    document.getElementById("total-membres").textContent = total;
    document.getElementById("total-hommes").textContent = hommes;
    document.getElementById("total-femmes").textContent = femmes;
    document.getElementById("inscriptions-mois").textContent =
        inscriptionsMois;

    // Graphique circulaire hommes / femmes
    const canvas = document.getElementById("graphique-sexe");

    if (canvas && typeof Chart !== "undefined") {
        const donneesSexe = {
            labels: ["Hommes", "Femmes"],
            datasets: [{
                data: [hommes, femmes],
                backgroundColor: ["#2563eb", "#ec4899"],
                borderColor: ["#ffffff", "#ffffff"],
                borderWidth: 3
            }]
        };

        if (window.graphiqueSexe) {
            window.graphiqueSexe.data = donneesSexe;
            window.graphiqueSexe.update();
        } else {
            const pluginsGraphique =
                typeof ChartDataLabels !== "undefined"
                    ? [ChartDataLabels]
                    : [];

            window.graphiqueSexe = new Chart(canvas, {
                type: "doughnut",
                data: donneesSexe,
                plugins: pluginsGraphique,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "bottom"
                        },
                        datalabels: {
                            color: "#ffffff",
                            font: {
                                weight: "bold",
                                size: 16
                            },
                            formatter: (valeur, contexte) => {
                                const donnees =
                                    contexte.chart.data.datasets[0].data;

                                const somme = donnees.reduce(
                                    (acc, nombre) => acc + nombre,
                                    0
                                );

                                if (somme === 0) return "";

                                return (
                                    (valeur / somme * 100).toFixed(1) + "%"
                                );
                            }
                        }
                    }
                }
            });
        }
    }
}

// Afficher les membres dans le tableau
function ouvrirCarteMembre(membre) {
    const echapper = texte => String(texte ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const dateFr = valeur => {
        if (!valeur) return "";
        const morceaux = String(valeur).slice(0, 10).split("-");
        return morceaux.length === 3 ? morceaux.reverse().join("/") : valeur;
    };

    const calculerAge = valeur => {
        const naissance = new Date(valeur);
        if (!valeur || isNaN(naissance)) return "";
        const aujourdhui = new Date();
        let age = aujourdhui.getFullYear() - naissance.getFullYear();
        const anniversaire = new Date(
            aujourdhui.getFullYear(), naissance.getMonth(), naissance.getDate()
        );
        if (aujourdhui < anniversaire) age--;
        return `${age} ans`;
    };

    const connus = ["id", "prenom", "nom", "sexe", "date_naissance", "telephone",
        "email", "profession", "fonction", "date_inscription"];

    const informations = [
        ["Sexe", membre.sexe],
        ["Date de naissance", dateFr(membre.date_naissance)],
        ["Âge", calculerAge(membre.date_naissance)],
        ["Téléphone", membre.telephone],
        ["E-mail", membre.email],
        ["Profession", membre.profession],
        ["Inscrit le", dateFr(membre.date_inscription)]
    ];

    // Autres informations éventuelles enregistrées pour ce membre
    Object.keys(membre).forEach(cle => {
        if (connus.includes(cle) || /mot_de_passe|hash|token/i.test(cle)) return;
        if (membre[cle] === null || membre[cle] === "" || typeof membre[cle] === "object") return;
        const titre = cle.replace(/_/g, " ");
        informations.push([titre.charAt(0).toUpperCase() + titre.slice(1), String(membre[cle])]);
    });

    const initiales = `${(membre.prenom || "?")[0]}${(membre.nom || "")[0] || ""}`.toUpperCase();

    const lignes = informations.map(([titre, valeur]) => `
        <div style="display:flex; justify-content:space-between; gap:16px;
                    padding:9px 0; border-bottom:1px solid #e5ebe7;">
            <span style="color:#6b7c72;">${echapper(titre)}</span>
            <strong style="text-align:right; word-break:break-word;">
                ${valeur ? echapper(valeur) : '<span style="color:#9aa8a0; font-weight:normal;">Non renseigné</span>'}
            </strong>
        </div>`).join("");

    const ancienne = document.getElementById("carte-membre");
    if (ancienne) ancienne.remove();

    const carte = document.createElement("div");
    carte.id = "carte-membre";
    carte.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
    `;

    carte.innerHTML = `
        <div style="background:#fff; border-radius:16px; width:100%; max-width:440px;
                    max-height:88vh; overflow-y:auto; box-shadow:0 20px 50px rgba(0,0,0,.35);">
            <div style="background:#14532d; color:#fff; padding:26px 24px; text-align:center;
                        border-radius:16px 16px 0 0;">
                <div style="width:72px; height:72px; margin:0 auto 12px; border-radius:50%;
                            background:#fff; color:#14532d; font-size:26px; font-weight:bold;
                            display:flex; align-items:center; justify-content:center;">
                    ${echapper(initiales)}
                </div>
                <h2 style="margin:0; font-size:22px;">${echapper(membre.prenom)} ${echapper(membre.nom)}</h2>
                <p id="carte-bureau" style="margin:6px 0 0; opacity:.9;"></p>
            </div>
            <div style="padding:8px 24px 4px;">${lignes}</div>
            <div style="padding:16px 24px 22px; text-align:right;">
                <button id="fermer-carte" type="button"
                    style="padding:10px 22px; cursor:pointer; border:none; border-radius:8px;
                           background:#14532d; color:#fff; font-weight:bold;">
                    Fermer
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(carte);

    const fermer = () => {
        carte.remove();
        document.removeEventListener("keydown", surTouche);
    };
    const surTouche = evenement => {
        if (evenement.key === "Escape") fermer();
    };
    document.addEventListener("keydown", surTouche);
    document.getElementById("fermer-carte").onclick = fermer;
    carte.onclick = evenement => {
        if (evenement.target === carte) fermer();
    };

    // Fonction au bureau (si le membre en occupe une)
    fetch("/api/bureau")
        .then(reponse => reponse.json())
        .then(donnees => {
            const attribution = (donnees.bureau || []).find(
                b => String(b.membre_id) === String(membre.id)
            );
            const zone = document.getElementById("carte-bureau");
            if (attribution && zone) {
                zone.textContent = `Bureau : ${attribution.fonction}`;
            }
        })
        .catch(() => {});
}

function afficherMembres(membres) {
    tableau.replaceChildren();

    const total = membres.length;
    const nombrePages = Math.ceil(total / membresParPage);

    if (pageCourante > nombrePages && nombrePages > 0) {
        pageCourante = nombrePages;
    }

    if (total === 0) {
        const ligne = document.createElement("tr");
        const cellule = celluleTexte(
            tousLesMembres.length === 0
                ? "Aucun membre enregistré."
                : "Aucun membre ne correspond à la recherche."
        );

        cellule.colSpan = 10;
        ligne.appendChild(cellule);
        tableau.appendChild(ligne);

        actualiserPagination(0, 0, 0);
        return;
    }

    const debut = (pageCourante - 1) * membresParPage;

    const membresPage = membres.slice(
        debut,
        debut + membresParPage
    );
    console.log("Membres de la page :", membresPage);

    membresPage.forEach(membre => {
        const ligne = document.createElement("tr");

// Prénom cliquable
const cellulePrenom = document.createElement("td");
const lienPrenom = document.createElement("button");

lienPrenom.type = "button";
lienPrenom.textContent = membre.prenom || "";
lienPrenom.style.cssText = `
    border: none;
    background: transparent;
    color: #26372d;
    font-weight: bold;
    cursor: pointer;
`;

lienPrenom.addEventListener("click", () => {
    ouvrirCarteMembre(membre);
});

cellulePrenom.appendChild(lienPrenom);

// Nom cliquable
const celluleNom = document.createElement("td");
const lienNom = document.createElement("button");

lienNom.type = "button";
lienNom.textContent = membre.nom || "";
lienNom.style.cssText = `
    border: none;
    background: transparent;
    color: #26372d;
    font-weight: bold;
    cursor: pointer;
`;

lienNom.addEventListener("click", () => {
    ouvrirCarteMembre(membre);
});

celluleNom.appendChild(lienNom);

// Colonne téléphone
const celluleTelephone = document.createElement("td");
celluleTelephone.textContent = membre.telephone || "Non renseigné";

// Colonne actions
const celluleActions = document.createElement("td");

const boutonModifier = document.createElement("button");
boutonModifier.type = "button";
boutonModifier.textContent = "Modifier";
boutonModifier.addEventListener("click", () => {
    modifierMembre(membre);
});

const boutonSupprimer = document.createElement("button");
boutonSupprimer.type = "button";
boutonSupprimer.textContent = "Supprimer";
boutonSupprimer.addEventListener("click", () => {
    supprimerMembre(membre);
});

celluleActions.append(boutonModifier, boutonSupprimer);

// Toute la ligne ouvre la fiche du membre
ligne.style.cursor = "pointer";
ligne.title = "Cliquer pour voir la fiche";
ligne.addEventListener("click", evenement => {
    if (evenement.target.closest("button")) return;
    ouvrirCarteMembre(membre);
});

ligne.append(
    cellulePrenom,
    celluleNom,
    celluleTelephone,
    celluleActions
);

tableau.appendChild(ligne);
 });

    actualiserPagination(
        total,
        debut + 1,
        Math.min(debut + membresParPage, total)
    );
}

// Créer les commandes de pagination
function actualiserPagination(total, debut, fin) {
    const conteneur = document.getElementById("pagination-membres");

    if (!conteneur) return;

    conteneur.replaceChildren();

    const nombrePages = Math.ceil(total / membresParPage);

    const information = document.createElement("p");
    information.className = "pagination-info";
    information.textContent = total === 0
        ? "Aucun membre à afficher"
        : `Affichage de ${debut} à ${fin} sur ${total} membre(s)`;

    const commandes = document.createElement("div");
    commandes.className = "pagination-commandes";

    const precedent = document.createElement("button");
    precedent.type = "button";
    precedent.textContent = "‹";
    precedent.className = "page-btn";
    precedent.disabled = pageCourante <= 1;
    precedent.setAttribute("aria-label", "Page précédente");
    precedent.addEventListener("click", () => {
        if (pageCourante > 1) {
            pageCourante--;
            afficherMembres(membresFiltres);
        }
    });

    const numero = document.createElement("span");
    numero.className = "page-numero";
    numero.textContent = nombrePages > 0
        ? `${pageCourante} / ${nombrePages}`
        : "0 / 0";

    const suivant = document.createElement("button");
    suivant.type = "button";
    suivant.textContent = "›";
    suivant.className = "page-btn";
    suivant.disabled = pageCourante >= nombrePages;
    suivant.setAttribute("aria-label", "Page suivante");
    suivant.addEventListener("click", () => {
        if (pageCourante < nombrePages) {
            pageCourante++;
            afficherMembres(membresFiltres);
        }
    });

    commandes.append(precedent, numero, suivant);
    conteneur.append(information, commandes);
}

// Recherche des membres

function filtrerMembres() {
    const terme = recherche.value.trim().toLocaleLowerCase("fr");

    membresFiltres = tousLesMembres.filter(membre => {
        return [
    membre.prenom,
    membre.nom,
    membre.telephone,
    membre.email
].some(valeur =>
            String(valeur || "")
                .toLocaleLowerCase("fr")
                .includes(terme)
        );
    });

    pageCourante = 1;
    afficherMembres(membresFiltres);
}

// Charger les membres depuis le serveur
async function chargerMembres() {
    try {
        const reponse = await fetch("/api/membres");

        if (!reponse.ok) {
            throw new Error("Impossible de charger les membres.");
        }

        tousLesMembres = await reponse.json();
        console.log("Nombre de membres :", tousLesMembres.length);

        actualiserStatistiques();
        filtrerMembres();
    } catch (erreur) {
        tableau.replaceChildren();
        console.log("Tableau trouvé :", tableau);
        console.log("Membres à afficher :", membres.length);

        const ligne = document.createElement("tr");
        const cellule = celluleTexte(erreur.message);

        cellule.colSpan = 9;
        ligne.appendChild(cellule);
        tableau.appendChild(ligne);

        console.error(erreur);
    }
}

// Modifier un membre
async function modifierMembre(membre) {
    const prenom = prompt("Prénom :", membre.prenom);
    if (prenom === null) return;

    const nom = prompt("Nom :", membre.nom);
    if (nom === null) return;

    const sexe = prompt(
        "Sexe : saisir Masculin ou Féminin",
        membre.sexe
    );
    if (sexe === null) return;

    const date_naissance = prompt(
        "Date de naissance (AAAA-MM-JJ), laisser vide si inconnue :",
        membre.date_naissance || ""
    );
    if (date_naissance === null) return;

    const telephone = prompt(
        "Téléphone (9 chiffres), laisser vide si absent :",
        membre.telephone || ""
    );
    if (telephone === null) return;

    const email = prompt(
        "Adresse e-mail, laisser vide si absente :",
        membre.email || ""
    );
    if (email === null) return;

    const profession = prompt(
        "Profession :",
        membre.profession || ""
    );
    if (profession === null) return;


    if (!prenom.trim() || !nom.trim()) {
        alert("Le prénom et le nom sont obligatoires.");
        return;
    }

    if (!["Masculin", "Féminin"].includes(sexe)) {
        alert("Le sexe doit être Masculin ou Féminin.");
        return;
    }

    const telephoneNettoye = telephone.trim();
    const emailNettoye = email.trim();

    if (!telephoneNettoye && !emailNettoye) {
        alert("Il faut renseigner au moins un contact : téléphone ou e-mail.");
        return;
    }

    if (
        telephoneNettoye &&
        !/^[0-9]{9}$/.test(telephoneNettoye)
    ) {
        alert("Le téléphone doit contenir exactement 9 chiffres.");
        return;
    }

    if (
        emailNettoye &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNettoye)
    ) {
        alert("L'adresse e-mail n'est pas valide.");
        return;
    }

    if (
        date_naissance.trim() &&
        !/^\d{4}-\d{2}-\d{2}$/.test(date_naissance.trim())
    ) {
        alert("La date doit être au format AAAA-MM-JJ.");
        return;
    }

    const donnees = {
        prenom: prenom.trim(),
        nom: nom.trim(),
        sexe,
        date_naissance: date_naissance.trim() || null,
        telephone: telephoneNettoye || null,
        email: emailNettoye || null,
        profession: profession.trim(),
    };

    try {
        const reponse = await fetch(`/api/membres/${membre.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(donnees)
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(
                resultat.erreur || "Modification impossible."
            );
        }

        alert("Membre modifié avec succès.");
        await chargerMembres();
    } catch (erreur) {
        alert(erreur.message);
    }
}

// Supprimer un membre
async function supprimerMembre(membre) {
    const confirmation = confirm(
        `Voulez-vous vraiment supprimer ${membre.prenom} ${membre.nom} ? Cette action est irréversible.`
    );

    if (!confirmation) return;

    try {
        const reponse = await fetch(`/api/membres/${membre.id}`, {
            method: "DELETE"
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(
                resultat.erreur || "Suppression impossible."
            );
        }

        alert("Membre supprimé avec succès.");
        await chargerMembres();
    } catch (erreur) {
        alert(erreur.message);
    }
}

// Exporter tous les membres vers Excel
function exporterVersExcel() {
    if (typeof XLSX === "undefined") {
        alert(
            "La bibliothèque Excel n'est pas chargée. Vérifie ta connexion Internet."
        );
        return;
    }

    if (tousLesMembres.length === 0) {
        alert("Aucun membre à exporter.");
        return;
    }

    const donnees = tousLesMembres.map(membre => ({
        ID: membre.id,
        Prénom: membre.prenom,
        Nom: membre.nom,
        Sexe: membre.sexe,
        "Date de naissance": membre.date_naissance || "",
        Téléphone: membre.telephone,
        Profession: membre.profession || "",
        Fonction: membre.fonction || "",
        "Date d'inscription": membre.date_inscription || ""
    }));

    const feuille = XLSX.utils.json_to_sheet(donnees);

    feuille["!cols"] = [
        { wch: 8 },
        { wch: 18 },
        { wch: 20 },
        { wch: 12 },
        { wch: 20 },
        { wch: 16 },
        { wch: 22 },
        { wch: 20 },
        { wch: 20 }
    ];

    const classeur = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        classeur,
        feuille,
        "Liste des membres"
    );

    const date = new Date().toISOString().slice(0, 10);

    XLSX.writeFile(
        classeur,
        `Registre_Fogny_${date}.xlsx`
    );
}

// Écouter les événements
recherche.addEventListener("input", filtrerMembres);

if (boutonExport) {
    boutonExport.addEventListener("click", exporterVersExcel);
}

formulaire.addEventListener("submit", async event => {
    event.preventDefault();

    message.textContent = "";
    bouton.disabled = true;
    bouton.textContent = "Enregistrement en cours...";

    const donnees = {
        prenom: formulaire.elements["prenom"].value.trim(),
        nom: formulaire.elements["nom"].value.trim(),
        sexe: formulaire.elements["sexe"].value,
        date_naissance:
            formulaire.elements["date_naissance"].value || null,
        telephone:
            formulaire.elements["telephone"].value.trim(),
               profession:
            formulaire.elements["profession"].value.trim()
    };

    try {
        const reponse = await fetch("/api/membres", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(donnees)
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(
                resultat.erreur || "Enregistrement impossible."
            );
        }

        message.style.color = "#15803d";
        message.textContent = "Membre enregistré avec succès.";

        formulaire.reset();
        recherche.value = "";

        await chargerMembres();
    } catch (erreur) {
        message.style.color = "#dc2626";
        message.textContent = erreur.message;
    } finally {
        bouton.disabled = false;
        bouton.textContent = "Enregistrer le membre";
    }
});

// Chargement initial
chargerMembres();
const boutonDeconnexion = document.getElementById("bouton-deconnexion");

if (boutonDeconnexion) {
    boutonDeconnexion.addEventListener("click", async () => {
        try {
            const reponse = await fetch("/api/auth/logout", {
                method: "POST"
            });

            const resultat = await reponse.json();

            if (!reponse.ok) {
                throw new Error(resultat.erreur || "Déconnexion impossible.");
            }

            window.location.href = "/connexion.html";
        } catch (erreur) {
            alert(erreur.message);
        }
    });
}// =====================================
// =====================================
// NAVIGATION ENTRE LES PAGES
// =====================================

const liensNavigation = document.querySelectorAll(
    ".sidebar-nav .nav-link"
);

const pages = document.querySelectorAll(".page-section");

// Afficher le tableau de bord au démarrage
pages.forEach(page => {
    page.style.display = page.id === "dashboard" ? "block" : "none";
});

// Navigation avec un seul gestionnaire par lien
liensNavigation.forEach(lien => {
    lien.addEventListener("click", evenement => {
        evenement.preventDefault();

        const identifiant = lien.getAttribute("href").substring(1);
        const pageChoisie = document.getElementById(identifiant);

        if (!pageChoisie || !pageChoisie.classList.contains("page-section")) {
            alert("Cette page n'existe pas encore.");
            return;
        }

        pages.forEach(page => {
            page.style.display = "none";
        });

        pageChoisie.style.display = "block";

        liensNavigation.forEach(element => {
            element.classList.remove("active");
        });

        lien.classList.add("active");

        if (identifiant === "gestion-bureau") {
            chargerMembresPourBureau();
            chargerListeBureau();
        }

        if (identifiant === "reunions" && window.chargerReunions) {
            window.chargerReunions();
        }

        if (identifiant === "rapports" && window.chargerRapports) {
            window.chargerRapports();
        }

        if (identifiant === "supervisions" && window.chargerSupervisions) {
            window.chargerSupervisions();
        }

        if (identifiant === "pointages" && window.chargerPointages) {
            window.chargerPointages();
        }

        if (identifiant === "acces" && window.chargerAcces) {
            window.chargerAcces();
        }

        if (identifiant === "forum") {
            chargerForum();
        }
    });
});
// =====================================
// PROGRAMME HEBDOMADAIRE
// =====================================

async function chargerProgramme() {
    const tableau = document.getElementById("liste-programme");

    if (!tableau) return;

    try {
        const reponse = await fetch("/api/programme");
        const activites = await reponse.json();

        if (!reponse.ok) {
            throw new Error(activites.erreur || "Erreur de chargement.");
        }

        tableau.innerHTML = "";

        if (activites.length === 0) {
            tableau.innerHTML = `
                <tr>
                    <td colspan="6">Aucune activité programmée pour le moment.</td>
                </tr>
            `;
            return;
        }

        const jours = [
            "Lundi", "Mercredi", "Jeudi",
            "Vendredi", "Samedi", "Dimanche"
        ];

        activites.sort((a, b) => {
            const difference = jours.indexOf(a.jour) - jours.indexOf(b.jour);

            return difference !== 0
                ? difference
                : a.heure_debut.localeCompare(b.heure_debut);
        });

        activites.forEach(activite => {
            const ligne = document.createElement("tr");

            const valeurs = [
                activite.jour,
                `${activite.heure_debut.slice(0, 5)} - ${activite.heure_fin ? activite.heure_fin.slice(0, 5) : "À définir"}`,
                activite.activite,
                activite.lieu || "—",
                activite.observations || "—"
            ];

            valeurs.forEach(valeur => {
                const cellule = document.createElement("td");
                cellule.textContent = valeur;
                ligne.appendChild(cellule);
            });

            const actions = document.createElement("td");

            const boutonModifier = document.createElement("button");
            boutonModifier.textContent = "Modifier";
            boutonModifier.type = "button";
            boutonModifier.addEventListener("click", () => modifierActivite(activite));

            const boutonSupprimer = document.createElement("button");
            boutonSupprimer.textContent = "Supprimer";
            boutonSupprimer.type = "button";
            boutonSupprimer.addEventListener("click", () => supprimerActivite(activite));

            actions.appendChild(boutonModifier);
            actions.appendChild(boutonSupprimer);
            ligne.appendChild(actions);

            tableau.appendChild(ligne);
        });

    } catch (erreur) {
        console.error("Erreur programme :", erreur);

        tableau.innerHTML = `
            <tr>
                <td colspan="6">Impossible de charger le programme.</td>
            </tr>
        `;
    }
}
async function modifierActivite(activite) {
    const heureDebut = prompt("Nouvelle heure de début :", activite.heure_debut.slice(0, 5));
    if (heureDebut === null) return;

    const heureFin = prompt("Nouvelle heure de fin :", activite.heure_fin ? activite.heure_fin.slice(0, 5) : "");
    if (heureFin === null) return;

    const lieu = prompt("Nouveau lieu :", activite.lieu || "");
    if (lieu === null) return;

    const observations = prompt("Observations :", activite.observations || "");
    if (observations === null) return;

    const donnees = {
        jour: activite.jour,
        heure_debut: heureDebut,
        heure_fin: heureFin,
        activite: activite.activite,
        lieu,
        observations
    };

    try {
        const reponse = await fetch(`/api/programme/${activite.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(donnees)
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.erreur || "Modification impossible.");
        }

        alert("Activité modifiée avec succès.");
        await chargerProgramme();

    } catch (erreur) {
        alert(erreur.message);
    }
}

async function supprimerActivite(activite) {
    const confirmation = confirm(
        `Voulez-vous vraiment supprimer l'activité "${activite.activite}" ?`
    );

    if (!confirmation) return;

    try {
        const reponse = await fetch(`/api/programme/${activite.id}`, {
            method: "DELETE"
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.erreur || "Suppression impossible.");
        }

        alert("Activité supprimée avec succès.");
        await chargerProgramme();

    } catch (erreur) {
        alert(erreur.message);
    }
}

// Charger le programme au démarrage
chargerProgramme();
/* =====================================
   AJOUT D'UNE ACTIVITÉ AU PROGRAMME
===================================== */

const boutonAjouterActivite = document.getElementById("ajouter-activite");
const formulaireActivite = document.getElementById("formulaire-activite");
const formulaireAjoutActivite = document.getElementById("form-ajout-activite");
const boutonAnnulerActivite = document.getElementById("annuler-activite");

if (boutonAjouterActivite && formulaireActivite) {
    boutonAjouterActivite.addEventListener("click", () => {
        formulaireActivite.style.display = "block";
    });
}

if (boutonAnnulerActivite && formulaireActivite && formulaireAjoutActivite) {
    boutonAnnulerActivite.addEventListener("click", () => {
        formulaireActivite.style.display = "none";
        formulaireAjoutActivite.reset();
    });
}

if (formulaireAjoutActivite) {
    formulaireAjoutActivite.addEventListener("submit", async (event) => {
        event.preventDefault();

        const donnees = {
    jour: document.getElementById("jour-activite").value,
    heure_debut: document.getElementById("heure-debut-activite").value,
    heure_fin: document.getElementById("heure-fin-activite").value,
    activite: document.getElementById("nom-activite").value.trim(),
    lieu: document.getElementById("lieu-activite").value.trim(),
    observations: document.getElementById("observations-activite").value.trim()
};

        try {
            const reponse = await fetch("/api/programme", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(donnees)
            });

            const resultat = await reponse.json();

            if (!reponse.ok) {
                throw new Error(resultat.erreur || "Impossible d'enregistrer l'activité.");
            }

            alert("Activité enregistrée avec succès !");
            formulaireAjoutActivite.reset();
            formulaireActivite.style.display = "none";

            await chargerProgramme();

        } catch (erreur) {
            console.error("Erreur d'enregistrement :", erreur);
            alert(erreur.message);
        }
    });
}
// =====================================
// CHARGEMENT DU FORUM
// =====================================

async function chargerForum() {
    const liste = document.getElementById("liste-publications");

    if (!liste) return;

    try {
        const reponse = await fetch("/api/forum/publications");
        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.erreur || "Impossible de charger le forum.");
        }

        const publications = resultat.publications || [];

        if (publications.length === 0) {
            liste.textContent = "Aucune publication pour le moment.";
            return;
        }

        liste.innerHTML = "";

        publications.forEach(publication => {
            const article = document.createElement("article");
            article.className = "publication-forum";

            const contenu = document.createElement("p");
            contenu.textContent = publication.contenu;

            const auteur = document.createElement("small");
            auteur.textContent = publication.auteur || "Membre";

            article.appendChild(auteur);
            article.appendChild(contenu);
            liste.appendChild(article);
        });

    } catch (erreur) {
        console.error("Erreur Forum :", erreur);
        liste.textContent = "Impossible de charger les publications.";
    }
}

chargerForum();
// ================================
// GESTION DU BUREAU
// ================================

async function chargerMembresPourBureau() {
    const select = document.getElementById("bureau-membre");

    if (!select) return;

    try {
        const reponse = await fetch("/api/membres");
        const membres = await reponse.json();

        if (!reponse.ok) {
            throw new Error("Impossible de charger les membres.");
        }

        select.innerHTML = '<option value="">Choisir un membre</option>';

        membres.forEach(membre => {
            const option = document.createElement("option");
            option.value = membre.id;
            option.textContent = `${membre.prenom} ${membre.nom}`;
            select.appendChild(option);
        });

    } catch (erreur) {
        console.error(erreur);
        select.innerHTML = '<option value="">Erreur de chargement</option>';
    }
}

async function chargerListeBureau() {
    const liste = document.getElementById("liste-bureau");

    if (!liste) return;

    try {
        const reponse = await fetch("/api/bureau");
        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.message || "Impossible de charger le bureau.");
        }

        const attributions = resultat.bureau || [];

        if (attributions.length === 0) {
            liste.textContent = "Aucune fonction n'a encore été attribuée.";
            return;
        }

        liste.innerHTML = "";

        attributions.forEach(attribution => {
            const ligne = document.createElement("div");
            ligne.className = "publication-forum";

            const nom = document.createElement("strong");
            nom.textContent = `${attribution.membres.prenom} ${attribution.membres.nom}`;

            const fonction = document.createElement("p");
            fonction.textContent = attribution.fonction;

            const bouton = document.createElement("button");
            bouton.type = "button";
            bouton.textContent = "Retirer cette fonction";
            bouton.className = "btn-danger";

            bouton.addEventListener("click", () => {
                retirerFonctionBureau(attribution.id);
            });

            ligne.appendChild(nom);
            ligne.appendChild(fonction);
            ligne.appendChild(bouton);

            liste.appendChild(ligne);
        });

    } catch (erreur) {
        console.error(erreur);
        liste.textContent = "Impossible de charger les membres du bureau.";
    }
}

async function attribuerFonctionBureau(evenement) {
    evenement.preventDefault();

    const membreId = document.getElementById("bureau-membre").value;
    const fonction = document.getElementById("bureau-fonction").value.trim();

    if (!membreId || !fonction) {
        alert("Choisissez un membre et indiquez une fonction.");
        return;
    }

    try {
        const reponse = await fetch("/api/bureau", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                membre_id: membreId,
                fonction: fonction
            })
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.erreur || resultat.message || "Attribution impossible.");
        }

        alert("Fonction attribuée avec succès.");

        document.getElementById("bureau-fonction").value = "";

        await chargerListeBureau();

    } catch (erreur) {
        alert(erreur.message);
    }
}

async function retirerFonctionBureau(id) {
    if (!confirm("Voulez-vous vraiment retirer cette fonction ?")) {
        return;
    }

    try {
        const reponse = await fetch(`/api/bureau/${id}`, {
            method: "DELETE"
        });

        const resultat = await reponse.json();

        if (!reponse.ok) {
            throw new Error(resultat.erreur || resultat.message || "Suppression impossible.");
        }

        alert("Fonction retirée avec succès.");

        await chargerListeBureau();

    } catch (erreur) {
        alert(erreur.message);
    }
}

// Initialisation
document.addEventListener("DOMContentLoaded", () => {
    const formulaire = document.getElementById("form-attribution-bureau");

    if (formulaire) {
        formulaire.addEventListener("submit", attribuerFonctionBureau);
    }

    chargerMembresPourBureau();
    chargerListeBureau();
});