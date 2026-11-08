// =====================================
// TABLEAU DE BORD : MEMBRES DU BUREAU
// =====================================
(function () {
    const carte = document.getElementById("dashboard-bureau");
    const liste = document.getElementById("dashboard-bureau-liste");
    if (!carte || !liste) return;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    async function charger() {
        try {
            const reponse = await fetch("/api/bureau");
            if (!reponse.ok) { carte.hidden = true; return; }
            const d = await reponse.json();
            const bureau = (d.bureau || []).filter(b => b.membres);
            if (!bureau.length) {
                liste.innerHTML = "<p>Aucune fonction n'est encore attribuée au bureau.</p>";
                return;
            }
            liste.innerHTML = `<div class="table-container"><table>
                <thead><tr><th>Fonction</th><th>Membre</th><th>Téléphone</th></tr></thead>
                <tbody>${bureau.map(b => `<tr>
                    <td><strong>${esc(b.fonction)}</strong></td>
                    <td>${esc(b.membres.prenom)} ${esc(b.membres.nom)}</td>
                    <td>${esc(b.membres.telephone || "—")}</td></tr>`).join("")}</tbody>
            </table></div>`;
        } catch (e) {
            liste.textContent = "Impossible de charger les membres du bureau.";
        }
    }

    charger();
    const lien = document.querySelector('.nav-link[href="#dashboard"]');
    if (lien) lien.addEventListener("click", charger);
})();
