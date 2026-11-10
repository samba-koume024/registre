// =====================================
// POINTAGES : PRÉSENCES ET ABSENCES
// =====================================
(function () {
    const STATUTS = ["Présent", "Absent"];
    const zone = () => document.getElementById("pointages-contenu");
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    let membres = [], programme = [], activitesAffichees = [], categoriesProgramme = {}, bureauIds = [], programmeCourant = null;

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

            const codes = programmeCourant ? (categoriesProgramme[String(programmeCourant.id)] || []) : [];
            const concernes = window.membresConcernes(membres, codes, bureauIds);
            const libelles = window.CATEGORIES_FOGNY.filter(c => codes.includes(c.code)).map(c => c.libelle);

            const lignes = concernes.map(m => {
                const p = deja.get(String(m.id));
                return `<tr data-membre="${esc(m.id)}">
                    <td>${esc(m.prenom)} ${esc(m.nom)}</td>
                    <td><select class="pt-statut">
                        ${STATUTS.map(s => `<option ${(p ? (p.statut === "Retard" ? "Présent" : p.statut === "Excusé" ? "Absent" : p.statut) : "Absent") === s ? "selected" : ""}>${s}</option>`).join("")}
                    </select></td>
                    <td><input type="text" class="pt-obs" value="${esc(p ? p.observation : "")}" placeholder="Observation"></td>
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
                <p><strong>${d.pointages.length}</strong> pointage(s) déjà enregistré(s) pour cette date.
                <button type="button" id="pt-tous-presents">Tous présents</button></p>
                <p><input type="search" id="pt-recherche" placeholder="Rechercher un membre..." aria-label="Rechercher un membre"></p>
                <div class="table-container"><table>
                    <thead><tr><th>Membre</th><th>Statut</th><th>Observation</th></tr></thead>
                    <tbody>${lignes || '<tr><td colspan="3">Aucun membre dans les catégories concernées.</td></tr>'}</tbody>
                </table></div>
                <p id="pt-resume"></p>
                <button type="button" class="primary-button" id="pt-enregistrer">Enregistrer l'appel</button>
                ${blocInfos}`;

            const resume = () => {
                const total = {};
                cible.querySelectorAll(".pt-statut").forEach(s => total[s.value] = (total[s.value] || 0) + 1);
                document.getElementById("pt-resume").textContent =
                    STATUTS.map(s => `${s} : ${total[s] || 0}`).join(" · ");
            };
            cible.querySelectorAll(".pt-statut").forEach(s => s.onchange = resume);

            // Recherche : masque les lignes sans les retirer (les statuts restent enregistrés)
            const normaliser = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            document.getElementById("pt-recherche").addEventListener("input", e => {
                const motif = normaliser(e.target.value.trim());
                cible.querySelectorAll("tbody tr[data-membre]").forEach(tr => {
                    const nom = normaliser(tr.children[1].textContent);
                    tr.style.display = !motif || nom.includes(motif) ? "" : "none";
                });
            });
            document.getElementById("pt-tous-presents").onclick = () => {
                cible.querySelectorAll(".pt-statut").forEach(s => s.value = "Présent");
                resume();
            };
            document.getElementById("pt-enregistrer").onclick = async () => {
                const lignesAppel = [...cible.querySelectorAll("tbody tr[data-membre]")].map(tr => ({
                    membre_id: tr.dataset.membre,
                    statut: tr.querySelector(".pt-statut").value,
                    observation: tr.querySelector(".pt-obs").value.trim()
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
