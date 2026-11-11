// =====================================
// RAPPORTS DU MOUVEMENT (par activité)
// =====================================
(function () {
    const zone = () => document.getElementById("rapports-contenu");
    let rapport = null;
    let programme = [];

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const iso = d => d.toLocaleDateString("fr-CA");
    const dateFr = s => s ? s.split("-").reverse().join("/") : "";
    const heure = h => (h ? String(h).slice(0, 5) : "");
    const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

    async function api(url) {
        const reponse = await fetch(url);
        const donnees = await reponse.json().catch(() => ({}));
        if (!reponse.ok) throw new Error(donnees.message || "Chargement impossible.");
        return donnees;
    }

    // Activités du programme regroupées par nom (une activité peut avoir plusieurs jours)
    function activitesGroupees() {
        const groupes = new Map();
        programme.forEach(a => {
            if (!groupes.has(a.activite)) groupes.set(a.activite, []);
            groupes.get(a.activite).push(a);
        });
        groupes.forEach(liste => liste.sort((x, y) =>
            JOURS.indexOf(x.jour) - JOURS.indexOf(y.jour) || String(x.heure_debut).localeCompare(String(y.heure_debut))));
        return groupes;
    }

    function afficherCadre() {
        const fin = new Date();
        const debut = new Date(fin.getFullYear(), fin.getMonth(), 1);
        const cases = [...activitesGroupees()].map(([nom, creneaux]) => `
            <label class="rp-activite">
                <input type="checkbox" class="rp-act" value="${esc(nom)}" checked>
                <span><strong>${esc(nom)}</strong><br>
                <small>${creneaux.map(c => `${esc(c.jour)} ${heure(c.heure_debut)}${c.heure_fin ? " – " + heure(c.heure_fin) : ""}`).join(" · ")}</small></span>
            </label>`).join("");

        zone().innerHTML = `
            <div class="content-card">
                <h3>Générer un rapport</h3>
                <p>
                    <label for="rp-debut">Du</label>
                    <input type="date" id="rp-debut" value="${iso(debut)}">
                    <label for="rp-fin">au</label>
                    <input type="date" id="rp-fin" value="${iso(fin)}">
                </p>
                <h4>Activités à inclure dans le rapport</h4>
                <p><small>Cochez une ou plusieurs activités.</small>
                <button type="button" id="rp-tout">Tout cocher</button>
                <button type="button" id="rp-rien">Tout décocher</button></p>
                ${cases ? `<div class="rp-activites">${cases}</div>` : "<p>Aucune activité dans le programme hebdomadaire.</p>"}
                <p>
                    <button type="button" id="rp-generer" class="primary-button">Générer le rapport</button>
                    <button type="button" id="rp-excel">Exporter vers Excel</button>
                    <button type="button" id="rp-imprimer">Imprimer / enregistrer en PDF</button>
                </p>
            </div>
            <div id="rp-rapport"></div>`;
        document.getElementById("rp-generer").onclick = generer;
        document.getElementById("rp-excel").onclick = exporter;
        document.getElementById("rp-imprimer").onclick = imprimer;
        document.getElementById("rp-tout").onclick = () => zone().querySelectorAll(".rp-act").forEach(c => c.checked = true);
        document.getElementById("rp-rien").onclick = () => zone().querySelectorAll(".rp-act").forEach(c => c.checked = false);
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

        const choisies = [...zone().querySelectorAll(".rp-act:checked")].map(c => c.value);
        if (!choisies.length) return alert("Choisissez au moins une activité.");

        cible.textContent = "Génération en cours...";
        try {
            const parametres = new URLSearchParams({ debut, fin });
            choisies.forEach(a => parametres.append("activite", a));

            const [membres, activites, bureau, coursRapport] = await Promise.all([
                api("/api/membres"),
                api(`/api/rapport-activites?${parametres}`),
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

            // Horaires des activités choisies, tirés du programme
            const groupes = activitesGroupees();
            const horaires = activites.activites.map(a => ({
                activite: a.activite,
                seances: a.seances,
                creneaux: (groupes.get(a.activite) || []).map(c => ({
                    jour: c.jour, debut: heure(c.heure_debut), fin: heure(c.heure_fin), lieu: c.lieu || ""
                }))
            }));

            rapport = {
                debut, fin, total: membres.length, hommes, femmes, nouveaux, tranches, dirigeants,
                horaires, activites: activites.activites,
                cours: (coursRapport.cours || []).filter(c => choisies.includes(c.activite))
            };
            cible.innerHTML = `<div id="rp-document">${construireHtml(rapport)}</div>`;
        } catch (e) {
            cible.textContent = e.message;
        }
    }

    function construireHtml(r) {
        const pc = n => r.total ? Math.round((n / r.total) * 100) + " %" : "—";

        const lignesHoraires = r.horaires.flatMap(h => h.creneaux.length
            ? h.creneaux.map((c, i) => `<tr><td>${i === 0 ? `<strong>${esc(h.activite)}</strong>` : ""}</td>
                <td>${esc(c.jour)}</td><td>${esc(c.debut) || "—"}</td><td>${esc(c.fin) || "—"}</td>
                <td>${esc(c.lieu) || "—"}</td><td>${i === 0 ? h.seances : ""}</td></tr>`)
            : [`<tr><td><strong>${esc(h.activite)}</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td>${h.seances}</td></tr>`]
        ).join("");

        const blocsActivites = r.activites.map(a => `
            <h4>${esc(a.activite)} <small>(${a.seances} séance(s) pointée(s))</small></h4>
            <table><thead><tr><th>N°</th><th>Membre pointé</th><th>Présences</th><th>Absences</th><th>Taux de présence</th></tr></thead><tbody>
            ${a.membres.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.nom)}</td><td>${m.present}</td><td>${m.absent}</td>
                <td>${m.taux === null ? "—" : m.taux + " %"}</td></tr>`).join("")
                || '<tr><td colspan="5">Aucun pointage pour cette activité sur la période.</td></tr>'}
            </tbody></table>`).join("");

        return `
            <div class="content-card">
                <h3>Rapport du mouvement Registre Fogny</h3>
                <p>Période : du ${dateFr(r.debut)} au ${dateFr(r.fin)} · édité le ${dateFr(iso(new Date()))}</p>
            </div>
            <div class="content-card">
                <h3>1. Activités concernées</h3>
                <table><thead><tr><th>Activité</th><th>Jour</th><th>Heure de début</th><th>Heure de fin</th><th>Lieu</th><th>Séances pointées</th></tr></thead>
                <tbody>${lignesHoraires}</tbody></table>
            </div>
            <div class="content-card">
                <h3>2. Participation par activité</h3>
                <p><small>Chaque membre qui a été pointé (présent ou absent) figure dans la liste de l'activité.</small></p>
                ${blocsActivites}
            </div>
            <div class="content-card">
                <h3>3. Effectifs</h3>
                <p>Effectif total : <strong>${r.total}</strong> membre(s) ·
                Hommes : ${r.hommes} (${pc(r.hommes)}) · Femmes : ${r.femmes} (${pc(r.femmes)}) ·
                Nouvelles inscriptions sur la période : <strong>${r.nouveaux}</strong></p>
                <table><thead><tr><th>Tranche d'âge</th><th>Membres</th></tr></thead><tbody>
                ${Object.entries(r.tranches).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
                </tbody></table>
            </div>
            <div class="content-card">
                <h3>4. Membres du bureau</h3>
                <table><thead><tr><th>Membre</th><th>Fonction</th></tr></thead><tbody>
                ${r.dirigeants.map(d => `<tr><td>${esc(d.nom)}</td><td>${esc(d.fonction)}</td></tr>`).join("")
                    || '<tr><td colspan="2">Aucune fonction attribuée.</td></tr>'}
                </tbody></table>
            </div>
            ${r.cours && r.cours.length ? `<div class="content-card">
                <h3>5. Cours et évaluations</h3>
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

        ajouter("Activités", r.horaires.flatMap(h => (h.creneaux.length ? h.creneaux : [{}]).map(c => ({
            Activité: h.activite, Jour: c.jour || "", "Heure de début": c.debut || "",
            "Heure de fin": c.fin || "", Lieu: c.lieu || "", "Séances pointées": h.seances
        }))));
        ajouter("Participation", r.activites.flatMap(a => a.membres.map(m => ({
            Activité: a.activite, Membre: m.nom, Présences: m.present, Absences: m.absent, "Taux (%)": m.taux ?? ""
        }))));
        ajouter("Effectifs", [
            { Indicateur: "Effectif total", Valeur: r.total },
            { Indicateur: "Hommes", Valeur: r.hommes },
            { Indicateur: "Femmes", Valeur: r.femmes },
            { Indicateur: "Nouvelles inscriptions (période)", Valeur: r.nouveaux },
            ...Object.entries(r.tranches).map(([k, v]) => ({ Indicateur: k, Valeur: v }))
        ]);
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
                body{font-family:'Book Antiqua','Palatino Linotype',Palatino,Georgia,serif;margin:24px;color:#111}
                h3{margin:18px 0 6px;color:#1e40af}
                table{border-collapse:collapse;width:100%;margin:8px 0}
                th,td{border:1px solid #999;padding:6px 8px;text-align:left}
                th{background:#e3ecfb}
            </style></head><body>${doc.innerHTML}</body></html>`);
        fenetre.document.close();
        fenetre.focus();
        fenetre.print();
    }

    async function chargerRapports() {
        if (!zone()) return;
        try {
            const prog = await api("/api/programme");
            programme = Array.isArray(prog) ? prog : [];
        } catch (e) { programme = []; }
        afficherCadre();
    }

    window.chargerRapports = chargerRapports;
})();
