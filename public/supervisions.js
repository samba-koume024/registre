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
        debut.setDate(debut.getDate() - 90);

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
                <small>Taux de présence = présents ÷ (présents + absents).</small>
            </div>
            <div id="sv-resultat"></div>
            <div id="sv-inactifs"></div>
            <div id="sv-courbes"></div>`;

        document.getElementById("sv-analyser").onclick = analyser;
        document.getElementById("sv-exporter").onclick = exporter;
    }

    async function analyser() {
        const cible = document.getElementById("sv-resultat");
        const debut = document.getElementById("sv-debut").value;
        const fin = document.getElementById("sv-fin").value;
        afficherCourbes(debut, fin);
        afficherInactifs();
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
                    <td>${m.present}</td><td>${m.absent}</td>
                    <td><strong>${m.taux === null ? "—" : m.taux + " %"}</strong></td>
                </tr>`).join("");

            cible.innerHTML = `
                <div class="content-card">
                    <h3>Vue d'ensemble</h3>
                    <p>${t.seances} séance(s) pointée(s) · ${t.present} présences · ${t.absent} absences · taux de présence :
                    <strong>${t.taux === null ? "—" : t.taux + " %"}</strong></p>
                </div>
                <div class="content-card">
                    <h3>Membres à surveiller (${alertes.length})</h3>
                    ${alertes.length
                        ? `<ul>${alertes.map(m => `<li>${esc(m.nom)} : ${m.absent} absence(s)</li>`).join("")}</ul>`
                        : "<p>Aucun membre n'atteint le seuil d'alerte sur cette période.</p>"}
                </div>
                <div class="content-card">
                    <h3>Détail par membre</h3>
                    <div class="table-container"><table>
                        <thead><tr><th>Membre</th><th>Présent</th><th>Absent</th><th>Taux de présence</th></tr></thead>
                        <tbody>${lignes || '<tr><td colspan="4">Aucun pointage sur cette période.</td></tr>'}</tbody>
                    </table></div>
                </div>`;
        } catch (e) {
            cible.textContent = e.message;
        }
    }

    // ---------- Membres inactifs : plus de 5 absences à une même activité ----------
    async function afficherInactifs() {
        const cible = document.getElementById("sv-inactifs");
        if (!cible) return;
        try {
            const reponse = await fetch("/api/membres-inactifs");
            const d = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(d.message || "Impossible de charger les inactifs.");
            cible.innerHTML = `<div class="content-card">
                <h3>Membres inactifs (${d.inactifs.length})</h3>
                <p><small>Un membre est classé inactif lorsqu'il a été absent plus de ${d.seuil} fois à une même activité.</small></p>
                ${d.inactifs.length ? `<div class="table-container"><table>
                    <thead><tr><th>Membre</th><th>Activité concernée</th><th>Absences</th></tr></thead>
                    <tbody>${d.inactifs.map(m => m.activites.map((a, i) => `<tr>
                        <td>${i === 0 ? `<strong>${esc(m.nom)}</strong> <span class="badge-inactif">Inactif</span>` : ""}</td>
                        <td>${esc(a.activite)}</td><td>${a.absences}</td></tr>`).join("")).join("")}</tbody>
                </table></div>` : "<p>Aucun membre inactif pour le moment.</p>"}
            </div>`;
        } catch (e) {
            cible.innerHTML = `<div class="content-card"><p>${esc(e.message)}</p></div>`;
        }
    }

    // ---------- Courbes : évolution du taux d'absence par programme ----------
    let graphiques = [];

    async function afficherCourbes(debut, fin) {
        const cible = document.getElementById("sv-courbes");
        if (!cible || !debut || !fin) return;
        graphiques.forEach(g => g.destroy());
        graphiques = [];

        try {
            const reponse = await fetch(`/api/supervisions-evolution?debut=${debut}&fin=${fin}`);
            const d = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(d.message || "Impossible de charger les courbes.");

            if (!d.series.length) {
                cible.innerHTML = `<div class="content-card"><h3>Évolution du taux d'absence</h3>
                    <p>Aucun pointage sur cette période.</p></div>`;
                return;
            }
            if (typeof Chart === "undefined") {
                cible.innerHTML = `<div class="content-card"><h3>Évolution du taux d'absence</h3>
                    <p>Les graphiques ne sont pas disponibles sans connexion internet.</p></div>`;
                return;
            }

            const tendance = pts => {
                if (pts.length < 2) return "";
                const ecart = pts[pts.length - 1].taux - pts[pts.length - 2].taux;
                if (ecart === 0) return "Stable par rapport à la séance précédente";
                return `${ecart > 0 ? "▲ +" : "▼ "}${ecart} points par rapport à la séance précédente`;
            };

            cible.innerHTML = `<div class="content-card">
                <h3>Évolution du taux d'absence par programme</h3>
                <p><small>Chaque courbe suit le taux d'absence (absents ÷ membres pointés), séance après séance.</small></p>
                <div class="sv-courbes-grille">${d.series.map((s, i) => `
                    <div class="sv-courbe">
                        <h4>${esc(s.activite)}</h4>
                        <small>Dernière séance : <strong>${s.points[s.points.length - 1].taux} %</strong> d'absence
                        · ${esc(tendance(s.points))}</small>
                        <div class="sv-toile"><canvas id="sv-courbe-${i}"></canvas></div>
                    </div>`).join("")}
                </div></div>`;

            d.series.forEach((s, i) => {
                graphiques.push(new Chart(document.getElementById(`sv-courbe-${i}`), {
                    type: "line",
                    data: {
                        labels: s.points.map(p => p.date.split("-").reverse().slice(0, 2).join("/")),
                        datasets: [{
                            label: "Taux d'absence (%)",
                            data: s.points.map(p => p.taux),
                            borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,.12)",
                            fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#dc2626"
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { min: 0, max: 100, ticks: { callback: v => v + " %" } }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: {
                                label: c => {
                                    const p = s.points[c.dataIndex];
                                    return `${p.taux} % (${p.absents} absent(s) sur ${p.total})`;
                                }
                            } },
                            datalabels: { display: true, align: "top", color: "#991b1b",
                                font: { size: 11, weight: "bold" }, formatter: v => v + "%" }
                        }
                    }
                }));
            });
        } catch (e) {
            cible.innerHTML = `<div class="content-card"><p>${esc(e.message)}</p></div>`;
        }
    }

    function exporter() {
        if (!dernierResultat || !dernierResultat.membres.length) {
            return alert("Lancez d'abord une analyse avec des données.");
        }
        if (typeof XLSX === "undefined") return alert("Bibliothèque Excel indisponible.");
        const lignes = dernierResultat.membres.map(m => ({
            Membre: m.nom, Présent: m.present, Absent: m.absent, "Taux de présence (%)": m.taux ?? ""
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
