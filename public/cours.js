// =====================================
// COURS : NIVEAUX ET ÉVALUATIONS (notes sur 20)
// =====================================
(function () {
    const zone = () => document.getElementById("cours-contenu");
    let programme = [], coursIds = new Set(), membres = [];
    let coursCourant = null, niveauCourant = null, evaluations = [], ouverte = null;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dateFr = s => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "");
    const heure = h => (h ? String(h).slice(0, 5) : "");
    const noteTxt = n => (n === null || n === undefined ? "—" : String(Number(n).toFixed(2)).replace(/\.?0+$/, ""));

    async function api(url, methode = "GET", corps) {
        const options = { method: methode, headers: {} };
        if (corps) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(corps);
        }
        const reponse = await fetch(url, options);
        const res = await reponse.json().catch(() => ({}));
        if (!reponse.ok) throw new Error(res.message || "Une erreur est survenue.");
        return res;
    }

    async function agir(action, message) {
        try {
            await action();
            if (message) alert(message);
        } catch (e) { alert(e.message); }
    }

    const coursListe = () => programme.filter(p => coursIds.has(String(p.id)));
    const elevesDuNiveau = () => membres
        .filter(m => window.niveauDe(m) === niveauCourant)
        .sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr"));

    // ---------- Chargements ----------
    async function charger() {
        if (!zone()) return;
        try {
            const [prog, c, m] = await Promise.all([
                api("/api/programme"), api("/api/cours"), api("/api/membres").catch(() => [])
            ]);
            programme = Array.isArray(prog) ? prog : [];
            coursIds = new Set((c.cours || []).map(x => String(x.programme_id)));
            membres = m;
            await window.chargerNiveaux();
            if (coursCourant && !coursIds.has(String(coursCourant))) coursCourant = null;
            if (coursCourant) await chargerEvaluations();
            dessiner();
        } catch (e) { zone().textContent = e.message; }
    }

    async function chargerEvaluations() {
        if (!coursCourant || !niveauCourant) { evaluations = []; return; }
        const d = await api(`/api/evaluations?programme_id=${encodeURIComponent(coursCourant)}&niveau=${encodeURIComponent(niveauCourant)}`);
        evaluations = d.evaluations || [];
    }

    // ---------- Affichage ----------
    function dessiner() {
        const cours = coursListe();
        const disponibles = programme.filter(p => !coursIds.has(String(p.id)));

        const cartes = cours.map(p => `
            <button type="button" class="pt-activite ${String(p.id) === String(coursCourant) ? "cr-actif" : ""}" data-cours="${esc(p.id)}">
                <strong>${esc(p.activite)}</strong><br>
                <small>${esc(p.jour)} · ${heure(p.heure_debut)}</small><br>
                <span class="pt-go">Ouvrir le cours ›</span>
            </button>`).join("");

        let detail = "";
        const prog = programme.find(p => String(p.id) === String(coursCourant));
        if (prog) {
            const onglets = window.NIVEAUX_FOGNY.map(n => `
                <button type="button" class="cr-onglet ${n.nom === niveauCourant ? "cr-actif" : ""}" data-niveau="${esc(n.nom)}">${esc(n.nom)}</button>`).join("");
            detail = `<div class="content-card">
                <h3>${esc(prog.activite)}</h3>
                <p>${onglets}</p>
                ${niveauCourant ? detailNiveau() : "<p>Choisissez un niveau.</p>"}
                <p><button type="button" class="cr-gerer" id="cr-retirer">Retirer cette activité des cours</button></p>
            </div>`;
        }

        const lignesNiveaux = window.NIVEAUX_FOGNY.map(n => `
            <tr><td><strong>${esc(n.nom)}</strong></td>
            <td><input type="number" min="0" max="120" class="cr-age-min" data-nom="${esc(n.nom)}" value="${n.age_min}"></td>
            <td><input type="number" min="0" max="120" class="cr-age-max" data-nom="${esc(n.nom)}" value="${n.age_max}"></td></tr>`).join("");

        zone().innerHTML = `
            <div class="content-card">
                <h3>Cours</h3>
                <p>Les cours sont des activités du programme réparties par niveaux. Cliquez sur un cours pour gérer ses évaluations.</p>
                ${cartes ? `<div class="pt-activites">${cartes}</div>` : "<p>Aucun cours pour l'instant.</p>"}
                <p class="cr-gerer"><select id="cr-ajout">
                    <option value="">Choisir une activité du programme</option>
                    ${disponibles.map(p => `<option value="${esc(p.id)}">${esc(p.activite)} (${esc(p.jour)})</option>`).join("")}
                </select>
                <button type="button" id="cr-ajouter-cours" class="primary-button">Ajouter comme cours</button></p>
            </div>
            ${detail}
            <div id="cr-evaluation"></div>
            <div class="content-card">
                <h3>Tranches d'âge des niveaux</h3>
                <p><small>Chaque membre est placé automatiquement dans le niveau qui correspond à son âge.
                Les membres sans date de naissance ne sont dans aucun niveau.</small></p>
                <div class="table-container"><table>
                    <thead><tr><th>Niveau</th><th>Âge minimum</th><th>Âge maximum</th></tr></thead>
                    <tbody>${lignesNiveaux || '<tr><td colspan="3">Niveaux indisponibles.</td></tr>'}</tbody>
                </table></div>
                <p><button type="button" class="primary-button cr-gerer" id="cr-enregistrer-ages">Enregistrer les tranches d'âge</button></p>
            </div>`;
        brancher();
        if (ouverte) afficherEvaluation();
    }

    function detailNiveau() {
        const eleves = elevesDuNiveau();
        const lignes = evaluations.map(e => `<tr>
            <td>${dateFr(e.date_evaluation)}</td><td><strong>${esc(e.titre)}</strong></td>
            <td>${e.nb_notes}</td>
            <td>${e.moyenne === null ? "—" : noteTxt(e.moyenne) + " / 20"}</td>
            <td>${e.reussite === null ? "—" : e.reussite + " %"}</td>
            <td><button type="button" data-ouvrir-eval="${esc(e.id)}">Saisir / voir les notes</button>
            <button type="button" class="cr-gerer" data-suppr-eval="${esc(e.id)}">Supprimer</button></td></tr>`).join("");
        return `
            <p><strong>${eleves.length}</strong> élève(s) dans ce niveau.</p>
            ${eleves.length ? `<details><summary>Voir la liste des élèves</summary>
                <ul>${eleves.map(m => `<li>${esc(m.prenom)} ${esc(m.nom)} <small>(${window.ageMembre(m)} ans)</small></li>`).join("")}</ul></details>` : ""}
            <h4>Évaluations</h4>
            <div class="table-container"><table>
                <thead><tr><th>Date</th><th>Évaluation</th><th>Notes saisies</th><th>Moyenne</th><th>Réussite (≥ 10)</th><th></th></tr></thead>
                <tbody>${lignes || '<tr><td colspan="6">Aucune évaluation pour ce niveau.</td></tr>'}</tbody>
            </table></div>
            <p class="cr-gerer"><input id="cr-titre" placeholder="Titre (ex. Examen du 1er trimestre)">
            <input id="cr-date" type="date" value="${new Date().toLocaleDateString("fr-CA")}">
            <button type="button" class="primary-button" id="cr-creer-eval">Nouvelle évaluation</button></p>`;
    }

    async function afficherEvaluation() {
        const cible = document.getElementById("cr-evaluation");
        if (!cible || !ouverte) return;
        const eleves = elevesDuNiveau();
        cible.innerHTML = `<div class="content-card">
            <h3>${esc(ouverte.evaluation.titre)} · ${dateFr(ouverte.evaluation.date_evaluation)}</h3>
            <p><small>Notes sur 20. Laissez vide si l'élève n'a pas été évalué.</small></p>
            <div class="table-container"><table>
                <thead><tr><th>Élève</th><th>Note / 20</th></tr></thead>
                <tbody>${eleves.map(m => `<tr data-membre="${esc(m.id)}">
                    <td>${esc(m.prenom)} ${esc(m.nom)}</td>
                    <td><input type="number" class="cr-note" min="0" max="20" step="0.25"
                        value="${ouverte.notes.has(String(m.id)) ? ouverte.notes.get(String(m.id)) : ""}"></td></tr>`).join("")
                    || '<tr><td colspan="2">Aucun élève dans ce niveau.</td></tr>'}</tbody>
            </table></div>
            <p><button type="button" class="primary-button cr-gerer" id="cr-enregistrer-notes">Enregistrer les notes</button>
            <button type="button" id="cr-fermer-eval">Fermer</button></p>
        </div>`;
        document.getElementById("cr-fermer-eval").onclick = () => { ouverte = null; cible.innerHTML = ""; };
        document.getElementById("cr-enregistrer-notes").onclick = async () => {
            const notes = [...cible.querySelectorAll("tr[data-membre]")].map(tr => {
                const v = tr.querySelector(".cr-note").value.trim();
                return { membre_id: tr.dataset.membre, note: v === "" ? null : Number(v) };
            });
            if (notes.some(n => n.note !== null && (isNaN(n.note) || n.note < 0 || n.note > 20)))
                return alert("Les notes doivent être comprises entre 0 et 20.");
            await agir(() => api(`/api/evaluations/${ouverte.evaluation.id}/notes`, "PUT", { notes }), "Notes enregistrées.");
            await ouvrirEvaluation(ouverte.evaluation.id);
            await chargerEvaluations();
            dessiner();
        };
    }

    async function ouvrirEvaluation(id) {
        const d = await api(`/api/evaluations/${id}`);
        ouverte = {
            evaluation: d.evaluation,
            notes: new Map((d.notes || []).map(n => [String(n.membre_id), n.note]))
        };
    }

    // ---------- Actions ----------
    function brancher() {
        const z = zone();
        z.querySelectorAll("[data-cours]").forEach(b => b.onclick = async () => {
            coursCourant = b.dataset.cours;
            niveauCourant = niveauCourant || (window.NIVEAUX_FOGNY[0] || {}).nom || null;
            ouverte = null;
            await agir(chargerEvaluations);
            dessiner();
        });
        z.querySelectorAll("[data-niveau]").forEach(b => b.onclick = async () => {
            niveauCourant = b.dataset.niveau;
            ouverte = null;
            await agir(chargerEvaluations);
            dessiner();
        });
        const ajouter = document.getElementById("cr-ajouter-cours");
        if (ajouter) ajouter.onclick = async () => {
            const id = document.getElementById("cr-ajout").value;
            if (!id) return alert("Choisissez une activité.");
            await agir(() => api(`/api/cours/${encodeURIComponent(id)}`, "PUT"), "Cours ajouté.");
            charger();
        };
        const retirer = document.getElementById("cr-retirer");
        if (retirer) retirer.onclick = async () => {
            if (!confirm("Retirer cette activité des cours ? Ses évaluations et leurs notes seront supprimées.")) return;
            await agir(() => api(`/api/cours/${encodeURIComponent(coursCourant)}`, "DELETE"));
            coursCourant = null; ouverte = null;
            charger();
        };
        const creer = document.getElementById("cr-creer-eval");
        if (creer) creer.onclick = async () => {
            const titre = document.getElementById("cr-titre").value.trim();
            const date = document.getElementById("cr-date").value;
            if (!titre || !date) return alert("Le titre et la date sont obligatoires.");
            await agir(() => api("/api/evaluations", "POST",
                { programme_id: coursCourant, niveau: niveauCourant, titre, date_evaluation: date }), "Évaluation créée.");
            await agir(chargerEvaluations);
            dessiner();
        };
        z.querySelectorAll("[data-ouvrir-eval]").forEach(b => b.onclick = async () => {
            await agir(() => ouvrirEvaluation(b.dataset.ouvrirEval));
            afficherEvaluation();
            document.getElementById("cr-evaluation").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        z.querySelectorAll("[data-suppr-eval]").forEach(b => b.onclick = async () => {
            if (!confirm("Supprimer cette évaluation et toutes ses notes ?")) return;
            await agir(() => api(`/api/evaluations/${b.dataset.supprEval}`, "DELETE"));
            ouverte = null;
            await agir(chargerEvaluations);
            dessiner();
        });
        const ages = document.getElementById("cr-enregistrer-ages");
        if (ages) ages.onclick = async () => {
            const niveaux = window.NIVEAUX_FOGNY.map(n => ({
                nom: n.nom,
                age_min: Number(z.querySelector(`.cr-age-min[data-nom="${CSS.escape(n.nom)}"]`).value),
                age_max: Number(z.querySelector(`.cr-age-max[data-nom="${CSS.escape(n.nom)}"]`).value)
            }));
            await agir(() => api("/api/niveaux", "PUT", { niveaux }), "Tranches d'âge enregistrées.");
            charger();
        };
    }

    window.chargerCours = charger;
})();
