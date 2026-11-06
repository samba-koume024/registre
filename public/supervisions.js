// =====================================
// SUPERVISIONS : ANALYSE DES PARTICIPATIONS
// =====================================
(function () {
    const zone = () => document.getElementById("supervisions-contenu");
    let dernierResultat = null;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const iso = d => d.toLocaleDateString("fr-CA");

    function afficherCadre() {
        const fin = new Date();
        const debut = new Date();
        debut.setDate(debut.getDate() - 30);

        zone().innerHTML = `
            <div class="content-card">
                <h3>Période analysée</h3>
                <p>
                    <label for="sv-debut">Du</label>
                    <input type="date" id="sv-debut" value="${iso(debut)}">
                    <label for="sv-fin">au</label>
                    <input type="date" id="sv-fin" value="${iso(fin)}">
                    <label for="sv-seuil">Alerte à partir de</label>
                    <input type="number" id="sv-seuil" min="1" value="3" style="width:70px"> absences
                    <button type="button" id="sv-analyser">Analyser</button>
                    <button type="button" id="sv-exporter">Exporter vers Excel</button>
                </p>
                <small>Taux de présence = (présents + retards) ÷ (pointages hors excusés).</small>
            </div>
            <div id="sv-resultat"></div>`;

        document.getElementById("sv-analyser").onclick = analyser;
        document.getElementById("sv-exporter").onclick = exporter;
    }

    async function analyser() {
        const cible = document.getElementById("sv-resultat");
        const debut = document.getElementById("sv-debut").value;
        const fin = document.getElementById("sv-fin").value;
        const seuil = Math.max(1, Number(document.getElementById("sv-seuil").value) || 3);
        if (!debut || !fin) return alert("Choisissez les deux dates.");

        try {
            const reponse = await fetch(`/api/supervisions?debut=${debut}&fin=${fin}`);
            const d = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(d.message || "Impossible de charger l'analyse.");
            dernierResultat = d;

            const t = d.totaux;
            const alertes = d.membres.filter(m => m.absent >= seuil);

            const lignes = d.membres.map(m => `
                <tr ${m.absent >= seuil ? 'style="background:#fdecea"' : ""}>
                    <td>${esc(m.nom)}</td>
                    <td>${m.present}</td><td>${m.retard}</td><td>${m.excuse}</td><td>${m.absent}</td>
                    <td><strong>${m.taux === null ? "—" : m.taux + " %"}</strong></td>
                </tr>`).join("");

            cible.innerHTML = `
                <div class="content-card">
                    <h3>Vue d'ensemble</h3>
                    <p>${t.seances} séance(s) pointée(s) · ${t.present} présences · ${t.retard} retards ·
                    ${t.excuse} excusés · ${t.absent} absences · taux global :
                    <strong>${t.taux === null ? "—" : t.taux + " %"}</strong></p>
                </div>
                <div class="content-card">
                    <h3>Membres à surveiller (${alertes.length})</h3>
                    ${alertes.length
                        ? `<ul>${alertes.map(m => `<li>${esc(m.nom)} : ${m.absent} absence(s), ${m.retard} retard(s)</li>`).join("")}</ul>`
                        : "<p>Aucun membre n'atteint le seuil d'alerte sur cette période.</p>"}
                </div>
                <div class="content-card">
                    <h3>Détail par membre</h3>
                    <div class="table-container"><table>
                        <thead><tr><th>Membre</th><th>Présent</th><th>Retard</th><th>Excusé</th><th>Absent</th><th>Taux</th></tr></thead>
                        <tbody>${lignes || '<tr><td colspan="6">Aucun pointage sur cette période.</td></tr>'}</tbody>
                    </table></div>
                </div>`;
        } catch (e) {
            cible.textContent = e.message;
        }
    }

    function exporter() {
        if (!dernierResultat || !dernierResultat.membres.length) {
            return alert("Lancez d'abord une analyse avec des données.");
        }
        if (typeof XLSX === "undefined") return alert("Bibliothèque Excel indisponible.");
        const lignes = dernierResultat.membres.map(m => ({
            Membre: m.nom, Présent: m.present, Retard: m.retard,
            Excusé: m.excuse, Absent: m.absent, "Taux de présence (%)": m.taux ?? ""
        }));
        const classeur = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignes), "Supervision");
        XLSX.writeFile(classeur, "supervision-presences.xlsx");
    }

    function chargerSupervisions() {
        if (!zone()) return;
        afficherCadre();
        analyser();
    }

    window.chargerSupervisions = chargerSupervisions;
})();
