// =====================================
// POINTAGES : PRÉSENCES ET ABSENCES
// =====================================
(function () {
    const STATUTS = ["Présent", "Absent"];
    const zone = () => document.getElementById("pointages-contenu");
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    let membres = [], programme = [], activitesAffichees = [], categoriesProgramme = {}, bureauIds = [], programmeCourant = null, coursIds = new Set(), groupe = lireGroupe();

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    async function api(url, methode = "GET", corps) {
        const options = { method: methode, headers: {} };
        if (corps) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(corps);
        }
        const reponse = await fetch(url, options);
        const donnees = await reponse.json().catch(() => ({}));
        if (!reponse.ok) throw new Error(donnees.message || "Une erreur est survenue.");
        return donnees;
    }

    const aujourdhui = () => new Date().toLocaleDateString("fr-CA");

    // Dernière date (aujourd'hui incluse) tombant le jour demandé
    function dateDuJour(jour) {
        const d = new Date();
        const i = JOURS.indexOf(jour);
        if (i >= 0) d.setDate(d.getDate() - ((d.getDay() - i + 7) % 7));
        return d.toLocaleDateString("fr-CA");
    }

    const heure = h => (h ? String(h).slice(0, 5) : "");

    // Statut par défaut choisi pour les membres pas encore pointés (gardé sur l'appareil)
    function lireDefaut() {
        try { return localStorage.getItem("pt_defaut") === "Présent" ? "Présent" : "Absent"; }
        catch (e) { return "Absent"; }
    }
    function ecrireDefaut(valeur) {
        try { localStorage.setItem("pt_defaut", valeur); } catch (e) { /* ignoré */ }
    }

    // Groupe pointé par cette personne : "" (tous), "Féminin" ou "Masculin"
    function lireGroupe() {
        try {
            const g = localStorage.getItem("pt_groupe");
            return g === "Féminin" || g === "Masculin" ? g : "";
        } catch (e) { return ""; }
    }
    function ecrireGroupe(valeur) {
        try { localStorage.setItem("pt_groupe", valeur); } catch (e) { /* ignoré */ }
    }

    // Envoie, ou garde sur l'appareil si la connexion est absente
    async function envoyer(url, corps, succes) {
        try {
            await api(url, "PUT", corps);
            alert(succes);
            return true;
        } catch (e) {
            if ((e instanceof TypeError || !navigator.onLine) && window.FileAttente) {
                window.FileAttente.ajouter({ url, methode: "PUT", corps });
                alert("Hors ligne : enregistré sur cet appareil. Il sera envoyé dès le retour de la connexion.");
                return true;
            }
            alert(e.message);
            return false;
        }
    }

    function htmlProgramme() {
        const aujourdhui = JOURS[new Date().getDay()];
        activitesAffichees = [...programme].sort(
            (a, b) => (b.jour === aujourdhui) - (a.jour === aujourdhui));

        const cartes = activitesAffichees.map((a, i) => `
            <button type="button" class="pt-activite" data-i="${i}">
                <strong>${esc(a.activite)}</strong>
                ${a.jour === aujourdhui ? '<span class="pt-badge">Aujourd’hui</span>' : ""}<br>
                <small>${esc(a.jour)} · ${heure(a.heure_debut)}${a.heure_fin ? " – " + heure(a.heure_fin) : ""}${a.lieu ? " · " + esc(a.lieu) : ""}</small><br>
                <span class="pt-go">▶ Démarrer l'appel</span>
            </button>`).join("");

        return `<div class="content-card">
            <h3>Programme hebdomadaire</h3>
            <p>Cliquez sur une activité pour démarrer l'appel automatiquement.</p>
            ${cartes ? `<div class="pt-activites">${cartes}</div>`
                     : "<p>Aucune activité dans le programme hebdomadaire.</p>"}
        </div>`;
    }

    function demarrer(i) {
        const a = activitesAffichees[i];
        if (!a) return;
        programmeCourant = a;
        document.getElementById("pt-date").value = dateDuJour(a.jour);
        document.getElementById("pt-activite").value = a.activite;
        chargerAppel();
        document.getElementById("pt-date").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function afficherCadre() {
        zone().innerHTML = htmlProgramme() + `
            <div class="content-card">
                <h3>Faire l'appel</h3>
                <p>
                    <label for="pt-date">Date</label>
                    <input type="date" id="pt-date" value="${aujourdhui()}">
                    <label for="pt-activite">Activité (facultatif)</label>
                    <input type="text" id="pt-activite" placeholder="Ex. : Réunion du samedi">
                    <button type="button" id="pt-charger">Afficher</button>
                </p>
                <div id="pt-liste"></div>
            </div>`;
        document.getElementById("pt-charger").onclick = chargerAppel;
        document.getElementById("pt-activite").addEventListener("input", () => { programmeCourant = null; });
        zone().querySelectorAll(".pt-activite").forEach(b =>
            b.onclick = () => demarrer(Number(b.dataset.i)));
    }

    async function chargerAppel() {
        const date = document.getElementById("pt-date").value;
        const activite = document.getElementById("pt-activite").value.trim();
        const cible = document.getElementById("pt-liste");
        if (!date) return alert("Choisissez une date.");

        try {
            let d, info = null, precedente = null, horsLigne = false;
            try {
                d = await api(`/api/pointages?date=${encodeURIComponent(date)}&activite=${encodeURIComponent(activite)}`);
            } catch (e) {
                if (e instanceof TypeError || !navigator.onLine) { d = { pointages: [] }; horsLigne = true; }
                else throw e;
            }
            if (!horsLigne) {
                try {
                    const i = await api(`/api/pointage-infos?date=${encodeURIComponent(date)}&activite=${encodeURIComponent(activite)}`);
                    info = i.info; precedente = i.precedente;
                } catch (e) { /* informations facultatives */ }
            }
            const deja = new Map(d.pointages.map(p => [String(p.membre_id), p]));

            const estCours = Boolean(programmeCourant) && coursIds.has(String(programmeCourant.id));
            const codes = programmeCourant ? (categoriesProgramme[String(programmeCourant.id)] || []) : [];
            const concernes = window.membresConcernes(membres, codes, bureauIds).filter(m => !groupe || m.sexe === groupe);
            const libelles = window.CATEGORIES_FOGNY.filter(c => codes.includes(c.code)).map(c => c.libelle);

            const defautStatut = lireDefaut();
            const lignes = concernes.map(m => {
                const p = deja.get(String(m.id));
                const statut = p ? (p.statut === "Retard" ? "Présent" : p.statut === "Excusé" ? "Absent" : p.statut) : defautStatut;
                return `<tr data-membre="${esc(m.id)}" data-niveau="${esc(window.niveauDe(m))}" data-enregistre="${p ? 1 : 0}">
                    <td>${esc(m.prenom)} ${esc(m.nom)}</td>
                    <td><div class="pt-choix">
                        <label class="pt-opt pt-opt-present"><input type="radio" class="pt-statut" name="st-${esc(m.id)}" value="Présent" ${statut === "Présent" ? "checked" : ""}><span>Présent</span></label>
                        <label class="pt-opt pt-opt-absent"><input type="radio" class="pt-statut" name="st-${esc(m.id)}" value="Absent" ${statut === "Absent" ? "checked" : ""}><span>Absent</span></label>
                    </div></td>
                </tr>`;
            }).join("");

            const dateLongue = new Date(date + "T00:00:00").toLocaleDateString("fr-FR",
                { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            const lieuDefaut = (info && info.lieu) || (programmeCourant && programmeCourant.lieu) || "";
            const entete = `<div class="pt-entete">
                    <div><small>Activité</small><strong>${esc(activite || "Appel libre")}</strong></div>
                    <div><small>Date</small><strong>${esc(dateLongue)}</strong></div>
                    ${programmeCourant ? `<div><small>Horaire</small><strong>${heure(programmeCourant.heure_debut)}${programmeCourant.heure_fin ? " – " + heure(programmeCourant.heure_fin) : ""}</strong></div>` : ""}
                    <div class="pt-lieu"><small>Lieu de l'activité</small>
                        <input type="text" id="pt-lieu" value="${esc(lieuDefaut)}" placeholder="Où se déroule l'activité ?"></div>
                </div>
                ${horsLigne ? '<p class="pt-hors-ligne">Mode hors ligne : cet appel sera envoyé dès le retour de la connexion.</p>' : ""}`;
            const dateFrPrec = precedente ? precedente.date_pointage.split("-").reverse().join("/") : "";
            const blocInfos = `<div class="content-card pt-infos">
                    <h3>Informations de la semaine</h3>
                    <p><small>À mettre à jour chaque semaine pour cette activité.</small></p>
                    <textarea id="pt-infos" rows="5" placeholder="Informations, rappels, thème, décisions...">${esc(info ? info.informations : "")}</textarea>
                    ${!info && precedente ? `<p><small>Dernières informations enregistrées le ${dateFrPrec}.</small>
                        <button type="button" id="pt-reprendre">Reprendre celles de la semaine précédente</button></p>` : ""}
                    <p><button type="button" class="primary-button" id="pt-enregistrer-infos">Enregistrer les informations</button></p>
                </div>`;

            cible.innerHTML = `${entete}
                <p>${programmeCourant ? `<strong>${esc(programmeCourant.activite)}</strong> · ` : ""}${
                    libelles.length ? "Catégories concernées : " + esc(libelles.join(", ")) + " · " : ""}<strong>${concernes.length}</strong> membre(s) à pointer.</p>
                <p><label for="pt-groupe">Je pointe</label>
                <select id="pt-groupe">
                    <option value="" ${groupe === "" ? "selected" : ""}>Tous les membres</option>
                    <option value="Féminin" ${groupe === "Féminin" ? "selected" : ""}>Les femmes</option>
                    <option value="Masculin" ${groupe === "Masculin" ? "selected" : ""}>Les hommes</option>
                </select>
                <small>Deux personnes peuvent pointer en même temps : l'une les femmes, l'autre les hommes.</small></p>
                <p><strong>${concernes.filter(m => deja.has(String(m.id))).length}</strong> pointage(s) déjà enregistré(s) dans ce groupe.
                <button type="button" id="pt-tous-presents">Tous présents</button>
                <button type="button" id="pt-tous-absents">Tous absents</button></p>
                <p><label for="pt-defaut">Statut par défaut</label>
                <select id="pt-defaut">
                    <option value="Absent" ${defautStatut === "Absent" ? "selected" : ""}>Tout le monde absent</option>
                    <option value="Présent" ${defautStatut === "Présent" ? "selected" : ""}>Tout le monde présent</option>
                </select>
                <small>S'applique aux membres pas encore pointés.</small></p>
                ${estCours ? `<p><label for="pt-niveau">Niveau</label>
                    <select id="pt-niveau"><option value="">Tous les niveaux</option>
                    ${window.NIVEAUX_FOGNY.map(n => `<option value="${esc(n.nom)}">${esc(n.nom)}</option>`).join("")}</select></p>` : ""}
                <p><input type="search" id="pt-recherche" placeholder="Rechercher un membre..." aria-label="Rechercher un membre"></p>
                <div class="table-container"><table>
                    <thead><tr><th>Membre</th><th>Pointage</th></tr></thead>
                    <tbody>${lignes || '<tr><td colspan="2">Aucun membre à pointer dans ce groupe.</td></tr>'}</tbody>
                </table></div>
                <p id="pt-resume"></p>
                <button type="button" class="primary-button" id="pt-enregistrer">Enregistrer l'appel</button>
                ${blocInfos}`;

            const resume = () => {
                const total = {};
                cible.querySelectorAll(".pt-statut:checked").forEach(s => total[s.value] = (total[s.value] || 0) + 1);
                document.getElementById("pt-resume").textContent =
                    STATUTS.map(s => `${s} : ${total[s] || 0}`).join(" · ");
            };
            cible.querySelectorAll(".pt-statut").forEach(s => s.onchange = resume);
            const definir = (tr, statut) =>
                tr.querySelectorAll(".pt-statut").forEach(r => { r.checked = r.value === statut; });
            document.getElementById("pt-groupe").onchange = e => {
                groupe = e.target.value;
                ecrireGroupe(groupe);
                chargerAppel();
            };

            // Recherche : masque les lignes sans les retirer (les statuts restent enregistrés)
            const normaliser = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const filtrer = () => {
                const motif = normaliser(document.getElementById("pt-recherche").value.trim());
                const mots = motif.split(/\s+/).filter(Boolean);
                const selection = document.getElementById("pt-niveau");
                const niveau = selection ? selection.value : "";
                cible.querySelectorAll("tbody tr[data-membre]").forEach(tr => {
                    const nom = normaliser(tr.children[0].textContent);
                    const visible = mots.every(mot => nom.includes(mot)) && (!niveau || tr.dataset.niveau === niveau);
                    tr.style.display = visible ? "" : "none";
                });
            };
            document.getElementById("pt-recherche").addEventListener("input", filtrer);
            const choixNiveau = document.getElementById("pt-niveau");
            if (choixNiveau) choixNiveau.addEventListener("change", filtrer);
            document.getElementById("pt-tous-presents").onclick = () => {
                cible.querySelectorAll("tbody tr[data-membre]").forEach(tr => definir(tr, "Présent"));
                resume();
            };
            document.getElementById("pt-tous-absents").onclick = () => {
                cible.querySelectorAll("tbody tr[data-membre]").forEach(tr => definir(tr, "Absent"));
                resume();
            };
            document.getElementById("pt-defaut").onchange = e => {
                ecrireDefaut(e.target.value);
                cible.querySelectorAll('tr[data-membre][data-enregistre="0"]')
                    .forEach(tr => definir(tr, e.target.value));
                resume();
            };
            document.getElementById("pt-enregistrer").onclick = async () => {
                const lignesAppel = [...cible.querySelectorAll("tbody tr[data-membre]")].map(tr => ({
                    membre_id: tr.dataset.membre,
                    statut: (tr.querySelector(".pt-statut:checked") || {}).value || "Absent"
                }));
                const ok = await envoyer("/api/pointages",
                    { date, activite, pointages: lignesAppel }, "Appel enregistré.");
                if (ok && navigator.onLine) chargerAppel();
            };
            const repr = document.getElementById("pt-reprendre");
            if (repr) repr.onclick = () => {
                document.getElementById("pt-infos").value = precedente.informations || "";
                if (precedente.lieu && !document.getElementById("pt-lieu").value) {
                    document.getElementById("pt-lieu").value = precedente.lieu;
                }
            };
            document.getElementById("pt-enregistrer-infos").onclick = () => envoyer("/api/pointage-infos", {
                date, activite,
                lieu: document.getElementById("pt-lieu").value.trim(),
                informations: document.getElementById("pt-infos").value.trim()
            }, "Informations enregistrées.");
            resume();
        } catch (e) {
            cible.textContent = e.message;
        }
    }

    async function chargerPointages() {
        if (!zone()) return;
        try {
            membres = await api("/api/membres");
            await window.chargerNiveaux();
            try {
                const c = await api("/api/cours");
                coursIds = new Set((c.cours || []).map(x => String(x.programme_id)));
            } catch (e) { coursIds = new Set(); }
            try {
                const b = await api("/api/bureau");
                bureauIds = (b.bureau || []).map(x => String(x.membre_id));
            } catch (e) { bureauIds = []; }
            try {
                const l = await api("/api/programme-categories");
                categoriesProgramme = {};
                (l.liens || []).forEach(x => {
                    (categoriesProgramme[String(x.programme_id)] = categoriesProgramme[String(x.programme_id)] || []).push(x.categorie);
                });
            } catch (e) { categoriesProgramme = {}; }
            try {
                const prog = await api("/api/programme");
                programme = Array.isArray(prog) ? prog : [];
            } catch (e) {
                programme = [];
            }
            afficherCadre();
            chargerAppel();
        } catch (e) {
            zone().textContent = e.message;
        }
    }

    window.chargerPointages = chargerPointages;
})();
