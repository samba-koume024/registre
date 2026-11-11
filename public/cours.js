// =====================================
// COURS : NIVEAUX ET ÉVALUATIONS (notes sur 20, moyennes automatiques)
// =====================================
(function () {
    const zone = () => document.getElementById("cours-contenu");
    let programme = [], coursIds = new Set(), membres = [];
    let coursCourant = null, niveauCourant = null, evaluations = [];

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dateFr = s => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "");
    const heure = h => (h ? String(h).slice(0, 5) : "");
    const fmt = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : (Math.round(n * 100) / 100).toString().replace(".", ",");

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
            return true;
        } catch (e) { alert(e.message); return false; }
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
        evaluations = (d.evaluations || []).sort((a, b) =>
            String(a.date_evaluation).localeCompare(String(b.date_evaluation)));
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
                <p>Les cours sont des activités du programme réparties par niveaux. Cliquez sur un cours pour saisir les notes de chaque niveau.</p>
                ${cartes ? `<div class="pt-activites">${cartes}</div>` : "<p>Aucun cours pour l'instant.</p>"}
                <p class="cr-gerer"><select id="cr-ajout">
                    <option value="">Choisir une activité du programme</option>
                    ${disponibles.map(p => `<option value="${esc(p.id)}">${esc(p.activite)} (${esc(p.jour)})</option>`).join("")}
                </select>
                <button type="button" id="cr-ajouter-cours" class="primary-button">Ajouter comme cours</button></p>
            </div>
            ${detail}
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
        recalculer();
    }

    // Liste du niveau : une ligne par élève, une colonne par évaluation
    function detailNiveau() {
        const eleves = elevesDuNiveau();
        const formulaire = `
            <p class="cr-gerer"><input id="cr-titre" placeholder="Titre de l'évaluation (ex. Examen du 1er trimestre)">
            <input id="cr-date" type="date" value="${new Date().toLocaleDateString("fr-CA")}">
            <button type="button" class="primary-button" id="cr-creer-eval">Nouvelle évaluation</button></p>`;

        if (!eleves.length) {
            return `<p>Aucun élève dans le niveau <strong>${esc(niveauCourant)}</strong> : aucun membre n'a l'âge correspondant.</p>${formulaire}`;
        }

        const entetes = evaluations.map(e => `<th>${esc(e.titre)}<br><small>${dateFr(e.date_evaluation)}</small>
            <button type="button" class="cr-gerer cr-petit" data-suppr-eval="${esc(e.id)}" title="Supprimer cette évaluation">✕</button></th>`).join("");

        const lignes = eleves.map(m => `<tr data-membre="${esc(m.id)}">
            <td>${esc(m.prenom)} ${esc(m.nom)}</td>
            ${evaluations.map(e => {
                const n = (e.notes || []).find(x => String(x.membre_id) === String(m.id));
                return `<td><input type="number" class="cr-note" data-eval="${esc(e.id)}" min="0" max="20" step="0.25" value="${n ? n.note : ""}"></td>`;
            }).join("")}
            <td class="cr-moyenne-eleve"><strong>—</strong></td></tr>`).join("");

        const pied = evaluations.length ? `<tfoot><tr><td><strong>Moyenne de l'évaluation</strong></td>
            ${evaluations.map(e => `<td class="cr-moyenne-eval" data-eval="${esc(e.id)}">—</td>`).join("")}
            <td id="cr-moyenne-niveau"><strong>—</strong></td></tr></tfoot>` : "";

        return `
            <p class="cr-resume" id="cr-resume"></p>
            ${evaluations.length ? `<div class="table-container"><table class="cr-feuille">
                <thead><tr><th>Élève (${eleves.length})</th>${entetes}<th>Moyenne</th></tr></thead>
                <tbody>${lignes}</tbody>${pied}
            </table></div>
            <p class="cr-gerer"><button type="button" class="primary-button" id="cr-enregistrer-notes">Enregistrer les notes</button>
            <small>Les moyennes se calculent automatiquement pendant la saisie.</small></p>`
            : `<p>Aucune évaluation pour ce niveau. Créez-en une pour saisir les notes.</p>
               <ul>${eleves.map(m => `<li>${esc(m.prenom)} ${esc(m.nom)}</li>`).join("")}</ul>`}
            ${formulaire}`;
    }

    // Calcul automatique des moyennes (élève, évaluation, niveau)
    function recalculer() {
        const table = zone().querySelector(".cr-feuille");
        if (!table) return;
        const colorer = (cellule, valeur) => {
            cellule.style.color = valeur !== null && valeur < 10 ? "#b42318" : "";
        };
        const moyennesEleves = [];

        table.querySelectorAll("tbody tr[data-membre]").forEach(tr => {
            const notes = [...tr.querySelectorAll(".cr-note")]
                .map(i => i.value.trim()).filter(v => v !== "").map(Number).filter(n => !Number.isNaN(n));
            const cellule = tr.querySelector(".cr-moyenne-eleve");
            if (notes.length) {
                const moy = notes.reduce((t, n) => t + n, 0) / notes.length;
                moyennesEleves.push(moy);
                cellule.innerHTML = `<strong>${fmt(moy)}</strong>`;
                colorer(cellule, moy);
            } else {
                cellule.innerHTML = "<strong>—</strong>";
                colorer(cellule, null);
            }
        });

        table.querySelectorAll(".cr-moyenne-eval").forEach(cellule => {
            const valeurs = [...table.querySelectorAll(`.cr-note[data-eval="${CSS.escape(cellule.dataset.eval)}"]`)]
                .map(i => i.value.trim()).filter(v => v !== "").map(Number).filter(n => !Number.isNaN(n));
            const moy = valeurs.length ? valeurs.reduce((t, n) => t + n, 0) / valeurs.length : null;
            cellule.textContent = fmt(moy);
            colorer(cellule, moy);
        });

        const moyNiveau = moyennesEleves.length ? moyennesEleves.reduce((t, n) => t + n, 0) / moyennesEleves.length : null;
        const reussite = moyennesEleves.length ? Math.round(moyennesEleves.filter(n => n >= 10).length / moyennesEleves.length * 100) : null;
        const cNiveau = document.getElementById("cr-moyenne-niveau");
        if (cNiveau) { cNiveau.innerHTML = `<strong>${fmt(moyNiveau)}</strong>`; colorer(cNiveau, moyNiveau); }
        const resume = document.getElementById("cr-resume");
        if (resume) {
            resume.innerHTML = `Moyenne du niveau <strong>${esc(niveauCourant)}</strong> :
                <strong>${fmt(moyNiveau)} / 20</strong>
                ${reussite === null ? "" : ` · ${reussite} % des élèves ont 10 ou plus`}
                · ${moyennesEleves.length} élève(s) noté(s)`;
        }
    }

    // ---------- Actions ----------
    function brancher() {
        const z = zone();
        z.querySelectorAll("[data-cours]").forEach(b => b.onclick = async () => {
            coursCourant = b.dataset.cours;
            niveauCourant = niveauCourant || (window.NIVEAUX_FOGNY[0] || {}).nom || null;
            await agir(chargerEvaluations);
            dessiner();
        });
        z.querySelectorAll("[data-niveau]").forEach(b => b.onclick = async () => {
            niveauCourant = b.dataset.niveau;
            await agir(chargerEvaluations);
            dessiner();
        });
        z.querySelectorAll(".cr-note").forEach(i => i.addEventListener("input", recalculer));

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
            coursCourant = null;
            charger();
        };
        const creer = document.getElementById("cr-creer-eval");
        if (creer) creer.onclick = async () => {
            const titre = document.getElementById("cr-titre").value.trim();
            const date = document.getElementById("cr-date").value;
            if (!titre || !date) return alert("Le titre et la date sont obligatoires.");
            const ok = await agir(() => api("/api/evaluations", "POST",
                { programme_id: coursCourant, niveau: niveauCourant, titre, date_evaluation: date }));
            if (ok) { await agir(chargerEvaluations); dessiner(); }
        };
        z.querySelectorAll("[data-suppr-eval]").forEach(b => b.onclick = async () => {
            if (!confirm("Supprimer cette évaluation et toutes ses notes ?")) return;
            await agir(() => api(`/api/evaluations/${b.dataset.supprEval}`, "DELETE"));
            await agir(chargerEvaluations);
            dessiner();
        });
        const enregistrer = document.getElementById("cr-enregistrer-notes");
        if (enregistrer) enregistrer.onclick = async () => {
            const lignes = [...z.querySelectorAll(".cr-feuille tbody tr[data-membre]")];
            for (const e of evaluations) {
                const notes = lignes.map(tr => {
                    const v = tr.querySelector(`.cr-note[data-eval="${CSS.escape(String(e.id))}"]`).value.trim();
                    return { membre_id: tr.dataset.membre, note: v === "" ? null : Number(v) };
                });
                if (notes.some(n => n.note !== null && (Number.isNaN(n.note) || n.note < 0 || n.note > 20))) {
                    return alert(`Les notes de « ${e.titre} » doivent être comprises entre 0 et 20.`);
                }
                const ok = await agir(() => api(`/api/evaluations/${e.id}/notes`, "PUT", { notes }));
                if (!ok) return;
            }
            alert("Notes enregistrées.");
            await agir(chargerEvaluations);
            dessiner();
        };
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
