// =====================================
// POINTAGES : PRÉSENCES ET ABSENCES
// =====================================
(function () {
    const STATUTS = ["Présent", "Retard", "Excusé", "Absent"];
    const zone = () => document.getElementById("pointages-contenu");
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    let membres = [], programme = [], activitesAffichees = [];

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
        zone().querySelectorAll(".pt-activite").forEach(b =>
            b.onclick = () => demarrer(Number(b.dataset.i)));
    }

    async function chargerAppel() {
        const date = document.getElementById("pt-date").value;
        const activite = document.getElementById("pt-activite").value.trim();
        const cible = document.getElementById("pt-liste");
        if (!date) return alert("Choisissez une date.");

        try {
            const d = await api(`/api/pointages?date=${encodeURIComponent(date)}&activite=${encodeURIComponent(activite)}`);
            const deja = new Map(d.pointages.map(p => [String(p.membre_id), p]));

            const lignes = membres.map(m => {
                const p = deja.get(String(m.id));
                return `<tr data-membre="${esc(m.id)}">
                    <td>${esc(m.prenom)} ${esc(m.nom)}</td>
                    <td><select class="pt-statut">
                        ${STATUTS.map(s => `<option ${((p && p.statut) || "Présent") === s ? "selected" : ""}>${s}</option>`).join("")}
                    </select></td>
                    <td><input type="text" class="pt-obs" value="${esc(p ? p.observation : "")}" placeholder="Observation"></td>
                </tr>`;
            }).join("");

            cible.innerHTML = `
                <p><strong>${d.pointages.length}</strong> pointage(s) déjà enregistré(s) pour cette date.
                <button type="button" id="pt-tous-presents">Tous présents</button></p>
                <div class="table-container"><table>
                    <thead><tr><th>Membre</th><th>Statut</th><th>Observation</th></tr></thead>
                    <tbody>${lignes || '<tr><td colspan="3">Aucun membre.</td></tr>'}</tbody>
                </table></div>
                <p id="pt-resume"></p>
                <button type="button" class="primary-button" id="pt-enregistrer">Enregistrer l'appel</button>`;

            const resume = () => {
                const total = {};
                cible.querySelectorAll(".pt-statut").forEach(s => total[s.value] = (total[s.value] || 0) + 1);
                document.getElementById("pt-resume").textContent =
                    STATUTS.map(s => `${s} : ${total[s] || 0}`).join(" · ");
            };
            cible.querySelectorAll(".pt-statut").forEach(s => s.onchange = resume);
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
                try {
                    const r = await api("/api/pointages", "PUT", { date, activite, pointages: lignesAppel });
                    alert(r.message);
                    chargerAppel();
                } catch (e) { alert(e.message); }
            };
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
