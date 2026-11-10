// =====================================
// RAPPORTS DU MOUVEMENT
// =====================================
(function () {
    const zone = () => document.getElementById("rapports-contenu");
    let rapport = null;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const iso = d => d.toLocaleDateString("fr-CA");
    const dateFr = s => s ? s.split("-").reverse().join("/") : "";

    async function api(url) {
        const reponse = await fetch(url);
        const donnees = await reponse.json().catch(() => ({}));
        if (!reponse.ok) throw new Error(donnees.message || "Chargement impossible.");
        return donnees;
    }

    function afficherCadre() {
        const fin = new Date();
        const debut = new Date(fin.getFullYear(), fin.getMonth(), 1);
        zone().innerHTML = `
            <div class="content-card">
                <h3>Générer un rapport</h3>
                <p>
                    <label for="rp-debut">Du</label>
                    <input type="date" id="rp-debut" value="${iso(debut)}">
                    <label for="rp-fin">au</label>
                    <input type="date" id="rp-fin" value="${iso(fin)}">
                    <button type="button" id="rp-generer" class="primary-button">Générer le rapport</button>
                </p>
                <p>
                    <button type="button" id="rp-excel">Exporter vers Excel</button>
                    <button type="button" id="rp-imprimer">Imprimer / enregistrer en PDF</button>
                </p>
            </div>
            <div id="rp-rapport"></div>`;
        document.getElementById("rp-generer").onclick = generer;
        document.getElementById("rp-excel").onclick = exporter;
        document.getElementById("rp-imprimer").onclick = imprimer;
    }

    function age(naissance) {
        if (!naissance) return null;
        const n = new Date(naissance);
        if (isNaN(n)) return null;
        const auj = new Date();
        let a = auj.getFullYear() - n.getFullYear();
        if (auj < new Date(auj.getFullYear(), n.getMonth(), n.getDate())) a--;
        return a;
    }

    async function generer() {
        const cible = document.getElementById("rp-rapport");
        const debut = document.getElementById("rp-debut").value;
        const fin = document.getElementById("rp-fin").value;
        if (!debut || !fin || debut > fin) return alert("Période invalide.");

        cible.textContent = "Génération en cours...";
        try {
            const [membres, presences, bureau, coursRapport] = await Promise.all([
                api("/api/membres"),
                api(`/api/supervisions?debut=${debut}&fin=${fin}`),
                api("/api/bureau"),
                api(`/api/cours-rapport?debut=${debut}&fin=${fin}`).catch(() => ({ cours: [] }))
            ]);

            const hommes = membres.filter(m => m.sexe === "Masculin").length;
            const femmes = membres.filter(m => m.sexe === "Féminin").length;
            const nouveaux = membres.filter(m => {
                const d = (m.date_inscription || "").slice(0, 10);
                return d && d >= debut && d <= fin;
            }).length;

            const tranches = { "Moins de 18 ans": 0, "18 - 25 ans": 0, "26 - 35 ans": 0,
                "36 - 50 ans": 0, "Plus de 50 ans": 0, "Âge non renseigné": 0 };
            membres.forEach(m => {
                const a = age(m.date_naissance);
                if (a === null) tranches["Âge non renseigné"]++;
                else if (a < 18) tranches["Moins de 18 ans"]++;
                else if (a <= 25) tranches["18 - 25 ans"]++;
                else if (a <= 35) tranches["26 - 35 ans"]++;
                else if (a <= 50) tranches["36 - 50 ans"]++;
                else tranches["Plus de 50 ans"]++;
            });

            const dirigeants = (bureau.bureau || []).map(b => ({
                nom: `${b.membres.prenom} ${b.membres.nom}`, fonction: b.fonction
            }));

            rapport = { debut, fin, total: membres.length, hommes, femmes, nouveaux,
                tranches, dirigeants, presences, cours: coursRapport.cours || [] };
            cible.innerHTML = `<div id="rp-document">${construireHtml(rapport)}</div>`;
        } catch (e) {
            cible.textContent = e.message;
        }
    }

    function construireHtml(r) {
        const t = r.presences.totaux;
        const pc = n => r.total ? Math.round((n / r.total) * 100) + " %" : "—";
        return `
            <div class="content-card">
                <h3>Rapport du mouvement Registre Fogny</h3>
                <p>Période : du ${dateFr(r.debut)} au ${dateFr(r.fin)} · édité le ${dateFr(iso(new Date()))}</p>
            </div>
            <div class="content-card">
                <h3>1. Effectifs</h3>
                <p>Effectif total : <strong>${r.total}</strong> membre(s) ·
                Hommes : ${r.hommes} (${pc(r.hommes)}) · Femmes : ${r.femmes} (${pc(r.femmes)}) ·
                Nouvelles inscriptions sur la période : <strong>${r.nouveaux}</strong></p>
                <table><thead><tr><th>Tranche d'âge</th><th>Membres</th></tr></thead><tbody>
                ${Object.entries(r.tranches).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
                </tbody></table>
            </div>
            <div class="content-card">
                <h3>2. Participation</h3>
                <p>${t.seances} séance(s) pointée(s) · ${t.present} présences · ${t.absent} absences · taux de présence :
                <strong>${t.taux === null ? "—" : t.taux + " %"}</strong></p>
                <table><thead><tr><th>Membre</th><th>Présent</th><th>Absent</th><th>Taux</th></tr></thead><tbody>
                ${r.presences.membres.map(m => `<tr><td>${esc(m.nom)}</td><td>${m.present}</td><td>${m.absent}</td><td>${m.taux === null ? "—" : m.taux + " %"}</td></tr>`).join("")
                    || '<tr><td colspan="4">Aucun pointage sur cette période.</td></tr>'}
                </tbody></table>
            </div>
            <div class="content-card">
                <h3>3. Membres du bureau</h3>
                <table><thead><tr><th>Membre</th><th>Fonction</th></tr></thead><tbody>
                ${r.dirigeants.map(d => `<tr><td>${esc(d.nom)}</td><td>${esc(d.fonction)}</td></tr>`).join("")
                    || '<tr><td colspan="2">Aucune fonction attribuée.</td></tr>'}
                </tbody></table>
            </div>
            ${r.cours && r.cours.length ? `<div class="content-card">
                <h3>4. Cours et évaluations</h3>
                ${r.cours.map(c => `<h4>${esc(c.activite)} <small>(${esc(c.jour)})</small></h4>
                <table><thead><tr><th>Niveau</th><th>Effectif</th><th>Présence</th><th>Évaluations</th><th>Moyenne / 20</th><th>Réussite (≥ 10)</th></tr></thead><tbody>
                ${c.niveaux.map(n => `<tr><td>${esc(n.niveau)}</td><td>${n.effectif}</td>
                    <td>${n.presence === null ? "—" : n.presence + " %"}</td><td>${n.evaluations}</td>
                    <td>${n.moyenne === null ? "—" : n.moyenne}</td>
                    <td>${n.reussite === null ? "—" : n.reussite + " %"}</td></tr>`).join("")}
                </tbody></table>`).join("")}
            </div>` : ""}`;
    }

    function exporter() {
        if (!rapport) return alert("Générez d'abord un rapport.");
        if (typeof XLSX === "undefined") return alert("Bibliothèque Excel indisponible.");
        const r = rapport;
        const classeur = XLSX.utils.book_new();
        const ajouter = (nom, lignes) =>
            XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignes), nom);

        ajouter("Effectifs", [
            { Indicateur: "Effectif total", Valeur: r.total },
            { Indicateur: "Hommes", Valeur: r.hommes },
            { Indicateur: "Femmes", Valeur: r.femmes },
            { Indicateur: "Nouvelles inscriptions (période)", Valeur: r.nouveaux },
            ...Object.entries(r.tranches).map(([k, v]) => ({ Indicateur: k, Valeur: v }))
        ]);
        ajouter("Participation", r.presences.membres.map(m => ({
            Membre: m.nom, Présent: m.present, Absent: m.absent, "Taux (%)": m.taux ?? ""
        })));
        ajouter("Bureau", r.dirigeants.map(d => ({ Membre: d.nom, Fonction: d.fonction })));
        if (r.cours && r.cours.length) {
            ajouter("Cours", r.cours.flatMap(c => c.niveaux.map(n => ({
                Cours: c.activite, Niveau: n.niveau, Effectif: n.effectif,
                "Présence (%)": n.presence ?? "", Évaluations: n.evaluations,
                "Moyenne /20": n.moyenne ?? "", "Réussite (%)": n.reussite ?? ""
            }))));
        }
        XLSX.writeFile(classeur, `rapport-${r.debut}-${r.fin}.xlsx`);
    }

    function imprimer() {
        const doc = document.getElementById("rp-document");
        if (!rapport || !doc) return alert("Générez d'abord un rapport.");
        const fenetre = window.open("", "_blank");
        if (!fenetre) return alert("Autorisez les fenêtres pop-up pour imprimer.");
        fenetre.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
            <title>Rapport Registre Fogny</title>
            <style>
                body{font-family:\"Book Antiqua\",\"Palatino Linotype\",Palatino,Georgia,serif;margin:24px;color:#111}
                h3{margin:18px 0 6px;color:#1e40af}
                table{border-collapse:collapse;width:100%;margin:8px 0}
                th,td{border:1px solid #999;padding:6px 8px;text-align:left}
                th{background:#e3ecfb}
            </style></head><body>${doc.innerHTML}</body></html>`);
        fenetre.document.close();
        fenetre.focus();
        fenetre.print();
    }

    function chargerRapports() {
        if (!zone()) return;
        afficherCadre();
        generer();
    }

    window.chargerRapports = chargerRapports;
})();
