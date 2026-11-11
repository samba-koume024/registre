// =====================================
// RÉUNIONS : CONVOCATIONS, PARTICIPANTS, PROCÈS-VERBAUX
// =====================================
(function () {
    const PRESENCES = ["Présent", "Excusé", "Absent"];
    const STATUTS = ["Prévue", "Tenue", "Annulée"];
    const zone = () => document.getElementById("reunions-contenu");
    let membres = [], bureauIds = [], reunions = [], courante = null, filtre = "";

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dateFr = s => s ? s.slice(0, 10).split("-").reverse().join("/") : "";

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

    // ---------- Liste ----------
    function afficherListe() {
        courante = null;
        zone().innerHTML = `
            <div class="content-card">
                <p><button type="button" id="rn-nouvelle" class="primary-button">+ Nouvelle réunion</button>
                <input type="search" id="rn-recherche" placeholder="Rechercher une réunion..." value="${esc(filtre)}"></p>
            </div>
            <div id="rn-tableaux"></div>`;
        document.getElementById("rn-nouvelle").onclick = () => afficherFiche(null);
        document.getElementById("rn-recherche").oninput = e => { filtre = e.target.value; dessinerTableaux(); };
        dessinerTableaux();
    }

    function dessinerTableaux() {
        const cible = document.getElementById("rn-tableaux");
        if (!cible) return;
        const aujourdhui = new Date().toLocaleDateString("fr-CA");
        const motif = filtre.trim().toLowerCase();
        const jour = r => String(r.date_reunion).slice(0, 10);

        const filtrees = reunions.filter(r =>
            !motif || `${r.titre} ${r.lieu || ""}`.toLowerCase().includes(motif));
        const aVenir = filtrees
            .filter(r => r.statut === "Prévue" && jour(r) >= aujourdhui)
            .sort((a, b) => jour(a).localeCompare(jour(b)));
        const historique = filtrees
            .filter(r => !aVenir.includes(r))
            .sort((a, b) => jour(b).localeCompare(jour(a)));

        const tableau = liste => `<div class="table-container"><table>
            <thead><tr><th>Date</th><th>Titre</th><th>Lieu</th><th>Statut</th>
            <th>Présents</th><th>Absents</th><th>Excusés</th><th></th></tr></thead>
            <tbody>${liste.map(r => `<tr>
                <td>${dateFr(r.date_reunion)} ${esc(r.heure)}</td>
                <td><strong>${esc(r.titre)}</strong></td>
                <td>${esc(r.lieu)}</td>
                <td>${esc(r.statut)}</td>
                <td>${r.presents ?? 0}</td><td>${r.absents ?? 0}</td><td>${r.excuses ?? 0}</td>
                <td><button type="button" data-ouvrir="${esc(r.id)}">Consulter</button></td>
            </tr>`).join("") || '<tr><td colspan="8">Aucune réunion.</td></tr>'}</tbody>
        </table></div>`;

        cible.innerHTML = `
            <div class="content-card"><h3>Réunions à venir (${aVenir.length})</h3>${tableau(aVenir)}</div>
            <div class="content-card"><h3>Historique des réunions (${historique.length})</h3>${tableau(historique)}</div>`;
        cible.querySelectorAll("[data-ouvrir]").forEach(b => b.onclick = () => ouvrir(b.dataset.ouvrir));
    }

    async function ouvrir(id) {
        try {
            afficherFiche(await api(`/api/reunions/${id}`));
        } catch (e) { alert(e.message); }
    }

    // ---------- Fiche ----------
    function afficherFiche(d) {
        courante = d;
        const r = d ? d.reunion : { titre: "", date_reunion: new Date().toLocaleDateString("fr-CA"),
            heure: "", lieu: "", ordre_du_jour: "", proces_verbal: "", statut: "Prévue" };
        const part = new Map((d ? d.participants : []).map(p => [String(p.membre_id), p.presence]));

        zone().innerHTML = `
            <div class="content-card">
                <h3>${d ? "Réunion" : "Nouvelle réunion"}</h3>
                <p><label>Titre <input id="rn-titre" value="${esc(r.titre)}"></label>
                <label>Date <input type="date" id="rn-date" value="${esc((r.date_reunion || "").slice(0, 10))}"></label>
                <label>Heure <input type="time" id="rn-heure" value="${esc(r.heure)}"></label>
                <label>Lieu <input id="rn-lieu" value="${esc(r.lieu)}"></label>
                <label>Statut <select id="rn-statut">${STATUTS.map(s =>
                    `<option ${r.statut === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></p>
                <p><label>Ordre du jour<br><textarea id="rn-odj" rows="4" style="width:100%">${esc(r.ordre_du_jour)}</textarea></label></p>
            </div>
            <div class="content-card">
                <h3>Participants</h3>
                <p><button type="button" id="rn-tous">Sélectionner tous</button>
                <button type="button" id="rn-bureau">Sélectionner le bureau</button>
                <button type="button" id="rn-aucun">Aucun</button></p>
                <div class="table-container"><table>
                    <thead><tr><th>Participant</th><th>Membre</th><th>Présence</th></tr></thead>
                    <tbody>${membres.map(m => {
                        const p = part.get(String(m.id));
                        return `<tr data-membre="${esc(m.id)}">
                            <td><input type="checkbox" class="rn-coche" ${p ? "checked" : ""}></td>
                            <td>${esc(m.prenom)} ${esc(m.nom)}</td>
                            <td><select class="rn-presence">${PRESENCES.map(x =>
                                `<option ${((p === "Convoqué" ? "Présent" : p) || "Présent") === x ? "selected" : ""}>${x}</option>`).join("")}</select></td>
                        </tr>`;
                    }).join("")}</tbody>
                </table></div>
            </div>
            <div class="content-card">
                <h3>Procès-verbal</h3>
                <textarea id="rn-pv" rows="8" style="width:100%" placeholder="Décisions, points abordés...">${esc(r.proces_verbal)}</textarea>
            </div>
            <p>
                <button type="button" class="primary-button" id="rn-enregistrer">Enregistrer</button>
                <button type="button" id="rn-convocation">Imprimer la convocation</button>
                <button type="button" id="rn-imprimer-pv">Imprimer le procès-verbal</button>
                ${d ? '<button type="button" id="rn-supprimer">Supprimer</button>' : ""}
                <button type="button" id="rn-retour">Retour à la liste</button>
            </p>`;

        const cocher = fn => zone().querySelectorAll("tr[data-membre]").forEach(tr =>
            tr.querySelector(".rn-coche").checked = fn(tr.dataset.membre));
        document.getElementById("rn-tous").onclick = () => cocher(() => true);
        document.getElementById("rn-bureau").onclick = () => cocher(id => bureauIds.includes(id));
        document.getElementById("rn-aucun").onclick = () => cocher(() => false);
        document.getElementById("rn-retour").onclick = chargerReunions;
        document.getElementById("rn-enregistrer").onclick = enregistrer;
        document.getElementById("rn-convocation").onclick = () => imprimer("convocation");
        document.getElementById("rn-imprimer-pv").onclick = () => imprimer("pv");
        const sup = document.getElementById("rn-supprimer");
        if (sup) sup.onclick = supprimer;
    }

    function lireFiche() {
        const v = id => document.getElementById(id).value.trim();
        return {
            titre: v("rn-titre"), date_reunion: v("rn-date"), heure: v("rn-heure"),
            lieu: v("rn-lieu"), statut: v("rn-statut"), ordre_du_jour: v("rn-odj"),
            proces_verbal: v("rn-pv"),
            participants: [...zone().querySelectorAll("tr[data-membre]")]
                .filter(tr => tr.querySelector(".rn-coche").checked)
                .map(tr => ({ membre_id: tr.dataset.membre, presence: tr.querySelector(".rn-presence").value }))
        };
    }

    async function enregistrer() {
        const corps = lireFiche();
        if (!corps.titre || !corps.date_reunion) return alert("Le titre et la date sont obligatoires.");
        try {
            const r = courante
                ? await api(`/api/reunions/${courante.reunion.id}`, "PUT", corps)
                : await api("/api/reunions", "POST", corps);
            alert(r.message);
            await chargerReunions();
        } catch (e) { alert(e.message); }
    }

    async function supprimer() {
        if (!confirm("Supprimer définitivement cette réunion ?")) return;
        try {
            await api(`/api/reunions/${courante.reunion.id}`, "DELETE");
            await chargerReunions();
        } catch (e) { alert(e.message); }
    }

    // ---------- Impression ----------
    function imprimer(type) {
        const f = lireFiche();
        if (!f.titre || !f.date_reunion) return alert("Renseignez au moins le titre et la date.");
        const noms = f.participants.map(p => {
            const m = membres.find(x => String(x.id) === p.membre_id);
            return { nom: m ? `${m.prenom} ${m.nom}` : "?", presence: p.presence };
        });
        const cfg = window.ENTETE_FOGNY || {};
        const logo = cfg.logo ? `<img class="logo" src="${location.origin}${cfg.logo}" alt="Logo">` : "";
        const enteteInstitution = `<div class="entete">
            ${logo}
            ${(cfg.lignes || []).map(l =>
                `<div class="entete-ligne ${l.police === "edwardian" ? "edwardian" : "brush"}">${esc(l.texte)}</div>`).join("")}
        </div>`;
        const pied = cfg.pied ? `<div class="pied">${esc(cfg.pied)}</div>` : "";
        const entete = `${enteteInstitution}<h2>${esc(f.titre)}</h2>
            <p>${dateFr(f.date_reunion)}${f.heure ? " à " + esc(f.heure) : ""}${f.lieu ? " · " + esc(f.lieu) : ""}</p>`;
        const corps = type === "convocation"
            ? `${entete}<h3>Convocation</h3><p>Les personnes suivantes sont convoquées :</p>
               <ul>${noms.map(n => `<li>${esc(n.nom)}</li>`).join("")}</ul>
               <h3>Ordre du jour</h3><p style="white-space:pre-wrap">${esc(f.ordre_du_jour) || "—"}</p>${pied}`
            : `${entete}<h3>Procès-verbal</h3>
               <table><thead><tr><th>Participant</th><th>Présence</th></tr></thead><tbody>
               ${noms.map(n => `<tr><td>${esc(n.nom)}</td><td>${esc(n.presence)}</td></tr>`).join("")}</tbody></table>
               <h3>Ordre du jour</h3><p style="white-space:pre-wrap">${esc(f.ordre_du_jour) || "—"}</p>
               <h3>Compte rendu</h3><p style="white-space:pre-wrap">${esc(f.proces_verbal) || "—"}</p>${pied}`;

        const fenetre = window.open("", "_blank");
        if (!fenetre) return alert("Autorisez les fenêtres pop-up pour imprimer.");
        fenetre.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
            <title>${esc(f.titre)}</title><style>
            @page { margin: 16mm; }
            body{font-family:'Book Antiqua','Palatino Linotype',Palatino,Georgia,serif;margin:0;color:#111}
            .entete{text-align:center;margin-bottom:22px}
            .logo{display:block;margin:0 auto 4px;width:28mm;height:auto}
            .entete-ligne{line-height:1.15}
            .edwardian{font-family:'Edwardian Script ITC','Monotype Corsiva','Segoe Script',cursive;font-size:14pt}
            .brush{font-family:'Brush Script MT','Brush Script Std','Segoe Script',cursive;font-size:13pt}
            h2{font-family:'Bodoni MT','Bodoni MT Bold',Didot,'Times New Roman',serif;font-weight:bold;
               font-size:16pt;text-align:center;text-transform:uppercase;text-decoration:underline;margin:22px 0 4px}
            h2+p{text-align:center;margin-top:0}
            h3{color:#1e40af;border-bottom:1px solid #c7d2fe;padding-bottom:3px}
            table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 8px;text-align:left}
            th{background:#e3ecfb}
            .pied{margin-top:28px;padding-top:8px;border-top:1px solid #999;text-align:center;font-size:12px;color:#444}
            </style></head><body>${corps}</body></html>`);
        fenetre.document.close();

        // On attend que le logo soit chargé avant d'ouvrir l'impression
        let lance = false;
        const lancer = () => {
            if (lance) return;
            lance = true;
            fenetre.focus();
            fenetre.print();
        };
        const image = fenetre.document.querySelector("img.logo");
        if (image && !image.complete) {
            image.onload = lancer;
            image.onerror = lancer;
            setTimeout(lancer, 2500);
        } else {
            setTimeout(lancer, 150);
        }
    }

    // ---------- Chargement ----------
    async function chargerReunions() {
        if (!zone()) return;
        try {
            const [m, r, b] = await Promise.all([api("/api/membres"), api("/api/reunions"), api("/api/bureau")]);
            membres = m;
            reunions = r.reunions;
            bureauIds = (b.bureau || []).map(x => String(x.membre_id));
            afficherListe();
        } catch (e) {
            zone().textContent = e.message;
        }
    }

    window.chargerReunions = chargerReunions;
})();
