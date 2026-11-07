// =====================================
// ADMINISTRATEURS, RÔLES ET PERMISSIONS
// =====================================
(function () {
    const zone = () => document.getElementById("acces-contenu");
    let membres = [], roles = [], permissions = [], fonctions = [], admins = [], fonctionOuverte = "";

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

    async function agir(action, succes) {
        try {
            await action();
            if (succes) alert(succes);
        } catch (e) {
            alert(e.message);
        }
        await chargerAcces();
    }

    const optionsMembres = () => '<option value="">Choisir un membre</option>' +
        membres.map(m => `<option value="${esc(m.id)}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join("");

    function htmlAdmins(admins) {
        const lignes = admins.map(a => `
            <li>${esc(a.nom)} <small>(${a.type === "membre" ? "membre promu" : "compte administrateur"})</small>
            ${a.type === "membre" ? `<button type="button" data-retirer-admin="${esc(a.membre_id)}">Retirer</button>` : ""}</li>`).join("");
        return `<div class="content-card"><h3>Administrateurs</h3>
            <p>Les administrateurs ont automatiquement tous les droits. Il peut y en avoir plusieurs.</p>
            <ul>${lignes || "<li>Aucun administrateur.</li>"}</ul>
            <select id="acces-promo">${optionsMembres()}</select>
            <button type="button" id="acces-promouvoir">Promouvoir administrateur</button></div>`;
    }

    function htmlRoles() {
        const modules = [...new Set(permissions.map(p => p.module || "Autres"))];
        const blocs = roles.map(r => `
            <details class="acces-role" data-role="${esc(r.id)}">
                <summary><strong>${esc(r.nom)}</strong> ${r.est_systeme ? "<small>(rôle système, protégé)</small>" : ""}</summary>
                <p><input class="r-nom" value="${esc(r.nom)}" ${r.est_systeme ? "disabled" : ""}>
                <input class="r-desc" value="${esc(r.description)}" placeholder="Description" ${r.est_systeme ? "disabled" : ""}>
                ${r.est_systeme ? "" : `<button type="button" data-maj-role="${esc(r.id)}">Enregistrer</button>
                <button type="button" data-suppr-role="${esc(r.id)}">Supprimer</button>`}</p>
                ${modules.map(mod => `<fieldset><legend>${esc(mod)}</legend>
                    ${permissions.filter(p => (p.module || "Autres") === mod).map(p => `
                    <label><input type="checkbox" value="${esc(p.id)}" ${r.permission_ids.includes(p.id) ? "checked" : ""}>
                    ${esc(p.nom || p.code)}</label>`).join(" ")}</fieldset>`).join("")}
                <button type="button" data-perms-role="${esc(r.id)}">Enregistrer les permissions</button>
            </details>`).join("");
        return `<div class="content-card"><h3>Rôles</h3>${blocs}
            <h4>Créer un rôle</h4>
            <input id="nouveau-role-nom" placeholder="Nom du rôle">
            <input id="nouveau-role-desc" placeholder="Description">
            <button type="button" id="creer-role">Créer</button></div>`;
    }

    function htmlMembre() {
        return `<div class="content-card"><h3>Rôle et permissions d'un membre</h3>
            <select id="acces-membre">${optionsMembres()}</select>
            <div id="acces-detail-membre"></div></div>`;
    }

    async function afficherMembre(id) {
        const cible = document.getElementById("acces-detail-membre");
        if (!id) { cible.innerHTML = ""; return; }
        const d = await api(`/api/membres/${encodeURIComponent(id)}/permissions`);
        const roleActuel = d.role ? d.role.id : "";
        cible.innerHTML = `
            <p>Rôle : <select id="acces-role-membre"><option value="">Choisir un rôle</option>
            ${roles.map(r => `<option value="${esc(r.id)}" ${r.id === roleActuel ? "selected" : ""}>${esc(r.nom)}</option>`).join("")}
            </select> <button type="button" id="acces-donner-role">Attribuer</button></p>
            <table><thead><tr><th>Permission</th><th>Selon le rôle</th><th>Décision individuelle</th></tr></thead><tbody>
            ${d.permissions.map(p => `<tr><td>${esc(p.nom || p.code)}</td>
                <td>${p.autorisation_role ? "Autorisé" : "Non"}</td>
                <td><select data-perm="${esc(p.id)}">
                    <option value="">Suivre le rôle</option>
                    <option value="autoriser" ${p.decision_individuelle === "autoriser" ? "selected" : ""}>Autoriser</option>
                    <option value="refuser" ${p.decision_individuelle === "refuser" ? "selected" : ""}>Refuser</option>
                </select></td></tr>`).join("")}</tbody></table>`;
        document.getElementById("acces-donner-role").onclick = () => {
            const roleId = document.getElementById("acces-role-membre").value;
            if (!roleId) return alert("Choisissez un rôle.");
            agir(() => api(`/api/membres/${encodeURIComponent(id)}/role`, "PUT", { role_id: roleId }), "Rôle attribué.")
                .then(() => { document.getElementById("acces-membre").value = id; return afficherMembre(id); });
        };
        cible.querySelectorAll("select[data-perm]").forEach(sel => {
            sel.onchange = async () => {
                try {
                    const url = `/api/membres/${encodeURIComponent(id)}/permissions`;
                    if (sel.value) await api(url, "PUT", { permission_id: sel.dataset.perm, decision: sel.value });
                    else await api(`${url}/${sel.dataset.perm}`, "DELETE");
                } catch (e) { if (!/Aucune exception/.test(e.message)) alert(e.message); }
                afficherMembre(id);
            };
        });
    }

    function htmlFonctions() {
        const modules = [...new Set(permissions.map(p => p.module || "Autres"))];
        const blocs = fonctions.map(f => `
            <details class="acces-role" data-fonction="${esc(f.fonction)}" ${f.fonction === fonctionOuverte ? "open" : ""}>
                <summary><strong>${esc(f.fonction)}</strong> <small>(${f.permission_ids.length} permission(s))</small></summary>
                ${modules.map(mod => `<fieldset><legend>${esc(mod)}</legend>
                    ${permissions.filter(p => (p.module || "Autres") === mod).map(p => `
                    <label><input type="checkbox" value="${esc(p.id)}" ${f.permission_ids.includes(p.id) ? "checked" : ""}>
                    ${esc(p.nom || p.code)}</label>`).join(" ")}</fieldset>`).join("")}
                <button type="button" data-perms-fonction="${esc(f.fonction)}">Enregistrer les permissions</button>
            </details>`).join("");
        return `<div class="content-card"><h3>Permissions par fonction du bureau</h3>
            <p>Un membre qui occupe une fonction du bureau reçoit automatiquement les permissions cochées ici,
            en plus de celles de son rôle. Une décision individuelle reste prioritaire.</p>
            ${blocs || "<p>Aucune fonction attribuée pour l'instant.</p>"}
            <h4>Ajouter une fonction</h4>
            <input id="nouvelle-fonction" placeholder="Ex. : Trésorier">
            <button type="button" id="ajouter-fonction">Ajouter</button></div>`;
    }

    function dessiner() {
        const conteneur = zone();
        if (!conteneur) return;
        conteneur.innerHTML = htmlAdmins(admins) + htmlRoles() + htmlFonctions() + htmlMembre();
        brancher(conteneur);
    }

    async function chargerAcces() {
        const conteneur = zone();
        if (!conteneur) return;
        try {
            const [m, r, p, a, f] = await Promise.all([
                api("/api/membres"), api("/api/roles"), api("/api/permissions"), api("/api/administrateurs"), api("/api/fonctions-permissions")
            ]);
            membres = m; roles = r; fonctions = f.fonctions || []; permissions = p.permissions || p.data || p;
            if (!Array.isArray(permissions)) permissions = [];
            admins = a.administrateurs;
            dessiner();
        } catch (e) {
            conteneur.textContent = e.message;
        }
    }

    function brancher(c) {
        const val = id => document.getElementById(id).value.trim();
        document.getElementById("acces-promouvoir").onclick = () => {
            const id = val("acces-promo");
            if (!id) return alert("Choisissez un membre.");
            agir(() => api(`/api/membres/${encodeURIComponent(id)}/administrateur`, "PUT"), "Membre promu administrateur.");
        };
        c.querySelectorAll("[data-retirer-admin]").forEach(b => b.onclick = () => {
            if (confirm("Retirer les droits d'administrateur à ce membre ?"))
                agir(() => api(`/api/membres/${encodeURIComponent(b.dataset.retirerAdmin)}/administrateur`, "DELETE"));
        });
        document.getElementById("creer-role").onclick = () =>
            agir(() => api("/api/roles", "POST", { nom: val("nouveau-role-nom"), description: val("nouveau-role-desc") }), "Rôle créé.");
        c.querySelectorAll("[data-maj-role]").forEach(b => b.onclick = () => {
            const bloc = b.closest(".acces-role");
            agir(() => api(`/api/roles/${b.dataset.majRole}`, "PUT", {
                nom: bloc.querySelector(".r-nom").value, description: bloc.querySelector(".r-desc").value }), "Rôle modifié.");
        });
        c.querySelectorAll("[data-suppr-role]").forEach(b => b.onclick = () => {
            if (confirm("Supprimer ce rôle personnalisé ?"))
                agir(() => api(`/api/roles/${b.dataset.supprRole}`, "DELETE"), "Rôle supprimé.");
        });
        c.querySelectorAll("[data-perms-role]").forEach(b => b.onclick = () => {
            const ids = [...b.closest(".acces-role").querySelectorAll("input[type=checkbox]:checked")].map(i => i.value);
            agir(() => api(`/api/roles/${b.dataset.permsRole}/permissions`, "PUT", { permission_ids: ids }), "Permissions enregistrées.");
        });
        document.getElementById("ajouter-fonction").onclick = () => {
            const nom = val("nouvelle-fonction");
            if (!nom) return alert("Saisissez le nom de la fonction.");
            if (!fonctions.some(f => f.fonction.toLowerCase() === nom.toLowerCase())) {
                fonctions.push({ fonction: nom, permission_ids: [] });
            }
            fonctionOuverte = (fonctions.find(f => f.fonction.toLowerCase() === nom.toLowerCase()) || {}).fonction || nom;
            dessiner();
        };
        c.querySelectorAll("[data-perms-fonction]").forEach(b => b.onclick = () => {
            const ids = [...b.closest(".acces-role").querySelectorAll("input[type=checkbox]:checked")].map(i => i.value);
            fonctionOuverte = b.dataset.permsFonction;
            agir(() => api("/api/fonctions-permissions", "PUT",
                { fonction: b.dataset.permsFonction, permission_ids: ids }), "Permissions de la fonction enregistrées.");
        });
        document.getElementById("acces-membre").onchange = e =>
            afficherMembre(e.target.value).catch(err => alert(err.message));
    }

    window.chargerAcces = chargerAcces;
})();
