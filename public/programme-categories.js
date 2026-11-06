// =====================================
// PROGRAMME : SOUS-RUBRIQUES ET CATÉGORIES CONCERNÉES
// =====================================
(function () {
    const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    let programme = [], liens = {}, membres = [], bureauIds = [], ouvert = null;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const heure = h => (h ? String(h).slice(0, 5) : "");

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

    const libelleActivite = a =>
        `${a.activite} · ${a.jour} ${heure(a.heure_debut)}${a.heure_fin ? " – " + heure(a.heure_fin) : ""}`;

    function afficherSousMenu() {
        const cadre = document.getElementById("sous-menu-programme");
        if (!cadre) return;
        cadre.innerHTML = programme.map(a => `
            <a href="#programme" class="sous-lien" data-id="${esc(a.id)}">
                <span>${esc(a.activite)}</span><small>${esc(a.jour)}</small>
            </a>`).join("");
        cadre.querySelectorAll(".sous-lien").forEach(l => l.onclick = async e => {
            e.preventDefault();
            const lienProgramme = document.querySelector('.nav-link[href="#programme"]');
            if (lienProgramme) lienProgramme.click();
            await charger();
            ouvrir(l.dataset.id);
        });
    }

    function afficherPanneau() {
        const zone = document.getElementById("programme-categories");
        if (!zone) return;

        const cartes = programme.map(a => {
            const n = (liens[String(a.id)] || []).length;
            return `<button type="button" class="pt-activite" data-id="${esc(a.id)}">
                <strong>${esc(a.activite)}</strong><br>
                <small>${esc(a.jour)} · ${heure(a.heure_debut)}</small><br>
                <span class="pt-go">${n ? n + " catégorie(s)" : "Tous les membres"} ›</span>
            </button>`;
        }).join("");

        let detail = "";
        const a = programme.find(x => String(x.id) === String(ouvert));
        if (a) {
            const choisies = liens[String(a.id)] || [];
            const lignes = window.CATEGORIES_FOGNY.map(c => {
                const nb = window.membresConcernes(membres, [c.code], bureauIds).length;
                return `<tr>
                    <td>${esc(c.libelle)}</td>
                    <td>${nb} membre(s)</td>
                    <td><input type="checkbox" class="pc-coche" value="${c.code}" ${choisies.includes(c.code) ? "checked" : ""}></td>
                </tr>`;
            }).join("");
            detail = `<div class="content-card">
                <h3>${esc(libelleActivite(a))}</h3>
                <p>Choisissez les catégories concernées par cette activité. Au pointage, seuls
                leurs membres s'afficheront. Sans catégorie cochée, tous les membres sont concernés.</p>
                <div class="table-container"><table>
                    <thead><tr><th>Catégorie</th><th>Effectif</th><th>Concernée</th></tr></thead>
                    <tbody>${lignes}</tbody>
                </table></div>
                <small>Les membres sans date de naissance ne figurent dans aucune catégorie d'âge.</small>
                <p>
                    <button type="button" class="primary-button" id="pc-enregistrer">Enregistrer</button>
                    <button type="button" id="pc-tout">Tout cocher</button>
                    <button type="button" id="pc-fermer">Fermer</button>
                </p>
            </div>`;
        }

        zone.innerHTML = `<div class="content-card">
            <h3>Catégories concernées par activité</h3>
            <p>Cliquez sur une activité pour choisir les catégories de membres concernées.</p>
            ${cartes ? `<div class="pt-activites">${cartes}</div>` : "<p>Aucune activité programmée.</p>"}
        </div>${detail}`;

        zone.querySelectorAll(".pt-activite").forEach(b => b.onclick = () => ouvrir(b.dataset.id));
        if (a) {
            document.getElementById("pc-fermer").onclick = () => { ouvert = null; afficherPanneau(); };
            document.getElementById("pc-tout").onclick = () =>
                zone.querySelectorAll(".pc-coche").forEach(c => c.checked = true);
            document.getElementById("pc-enregistrer").onclick = async () => {
                const codes = [...zone.querySelectorAll(".pc-coche:checked")].map(c => c.value);
                try {
                    await api(`/api/programme/${encodeURIComponent(a.id)}/categories`, "PUT", { categories: codes });
                    liens[String(a.id)] = codes;
                    alert("Catégories enregistrées.");
                    afficherPanneau();
                } catch (e) { alert(e.message); }
            };
        }
    }

    function ouvrir(id) {
        ouvert = id;
        afficherPanneau();
        const zone = document.getElementById("programme-categories");
        if (zone) zone.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function charger() {
        try {
            const [prog, lie, m, b] = await Promise.all([
                api("/api/programme"), api("/api/programme-categories"),
                api("/api/membres"), api("/api/bureau")
            ]);
            programme = (Array.isArray(prog) ? prog : []).sort((x, y) =>
                JOURS.indexOf(x.jour) - JOURS.indexOf(y.jour) ||
                String(x.heure_debut).localeCompare(String(y.heure_debut)));
            liens = {};
            (lie.liens || []).forEach(l => {
                (liens[String(l.programme_id)] = liens[String(l.programme_id)] || []).push(l.categorie);
            });
            membres = m;
            bureauIds = (b.bureau || []).map(x => String(x.membre_id));
            afficherSousMenu();
            afficherPanneau();
        } catch (e) {
            const zone = document.getElementById("programme-categories");
            if (zone) zone.textContent = e.message;
        }
    }

    window.chargerProgrammeCategories = charger;
    charger();
})();
