// =====================================
// GESTION DES COMPTES
// =====================================
(function () {
    const zone = () => document.getElementById("comptes-contenu");
    let donnees = null;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
        await charger();
    }

    function demanderMotDePasse(minimum) {
        const mdp = prompt(`Nouveau mot de passe (${minimum} caractères minimum) :`);
        if (mdp === null) return null;
        if (mdp.length < minimum) { alert(`Le mot de passe doit contenir au moins ${minimum} caractères.`); return null; }
        return mdp;
    }

    function dessiner() {
        const d = donnees;
        const lignesAdmin = d.administrateurs.map(a => `
            <tr><td><strong>${esc(a.identifiant)}</strong>${String(a.id) === String(d.moi) ? " <small>(vous)</small>" : ""}</td>
            <td>Administrateur</td><td>Actif</td>
            <td><button type="button" data-mdp="administrateur" data-id="${esc(a.id)}">Mot de passe</button>
            ${String(a.id) === String(d.moi) ? "" : `<button type="button" data-suppr="administrateur" data-id="${esc(a.id)}">Supprimer</button>`}</td></tr>`).join("");

        const lignesMembres = d.comptes.map(c => `
            <tr><td><strong>${esc(c.nom)}</strong> ${c.administrateur ? '<span class="pt-badge">Administrateur</span>' : ""}</td>
            <td>Membre</td><td>${c.actif ? "Actif" : "<em>Désactivé</em>"}</td>
            <td><button type="button" data-mdp="membre" data-id="${esc(c.id)}">Mot de passe</button>
            <button type="button" data-statut="${esc(c.id)}" data-actif="${c.actif}">${c.actif ? "Désactiver" : "Activer"}</button>
            <button type="button" data-admin="${esc(c.membre_id)}" data-promu="${c.administrateur}">${c.administrateur ? "Retirer admin" : "Promouvoir admin"}</button>
            <button type="button" data-suppr="membre" data-id="${esc(c.id)}">Supprimer</button></td></tr>`).join("");

        const sansCompte = d.sans_compte.map(m => `
            <tr><td>${esc(m.prenom)} ${esc(m.nom)}</td>
            <td><button type="button" data-creer="${esc(m.id)}">Créer un compte</button></td></tr>`).join("");

        zone().innerHTML = `
            <div class="content-card"><h3>Comptes existants</h3>
                <div class="table-container"><table>
                    <thead><tr><th>Compte</th><th>Type</th><th>Statut</th><th>Actions</th></tr></thead>
                    <tbody>${lignesAdmin}${lignesMembres || ""}</tbody>
                </table></div>
            </div>
            <div class="content-card"><h3>Créer un compte administrateur</h3>
                <p><input id="cp-identifiant" placeholder="Identifiant">
                <input id="cp-mdp" type="password" placeholder="Mot de passe (10 caractères minimum)">
                <button type="button" class="primary-button" id="cp-creer-admin">Créer</button></p>
            </div>
            <div class="content-card"><h3>Membres sans compte (${d.sans_compte.length})</h3>
                <div class="table-container"><table>
                    <thead><tr><th>Membre</th><th></th></tr></thead>
                    <tbody>${sansCompte || '<tr><td colspan="2">Tous les membres ont un compte.</td></tr>'}</tbody>
                </table></div>
            </div>`;

        const z = zone();
        document.getElementById("cp-creer-admin").onclick = () => agir(() => api("/api/comptes/administrateur", "POST", {
            identifiant: document.getElementById("cp-identifiant").value.trim(),
            mot_de_passe: document.getElementById("cp-mdp").value
        }), "Compte administrateur créé.");

        z.querySelectorAll("[data-mdp]").forEach(b => b.onclick = () => {
            const mdp = demanderMotDePasse(b.dataset.mdp === "administrateur" ? 10 : 8);
            if (mdp) agir(() => api(`/api/comptes/${b.dataset.mdp}/${encodeURIComponent(b.dataset.id)}/mot-de-passe`, "PUT", { mot_de_passe: mdp }), "Mot de passe modifié.");
        });
        z.querySelectorAll("[data-statut]").forEach(b => b.onclick = () =>
            agir(() => api(`/api/comptes/membre/${encodeURIComponent(b.dataset.statut)}/statut`, "PUT", { actif: b.dataset.actif !== "true" })));
        z.querySelectorAll("[data-admin]").forEach(b => b.onclick = () =>
            agir(() => api(`/api/membres/${encodeURIComponent(b.dataset.admin)}/administrateur`, b.dataset.promu === "true" ? "DELETE" : "PUT")));
        z.querySelectorAll("[data-suppr]").forEach(b => b.onclick = () => {
            if (confirm("Supprimer définitivement ce compte ? Le membre lui-même n'est pas supprimé."))
                agir(() => api(`/api/comptes/${b.dataset.suppr}/${encodeURIComponent(b.dataset.id)}`, "DELETE"), "Compte supprimé.");
        });
        z.querySelectorAll("[data-creer]").forEach(b => b.onclick = () => {
            const mdp = demanderMotDePasse(8);
            if (mdp) agir(() => api("/api/comptes/membre", "POST", { membre_id: b.dataset.creer, mot_de_passe: mdp }), "Compte créé.");
        });
    }

    async function charger() {
        if (!zone()) return;
        try {
            donnees = await api("/api/comptes");
            dessiner();
        } catch (e) { zone().textContent = e.message; }
    }

    window.chargerComptes = charger;
})();
