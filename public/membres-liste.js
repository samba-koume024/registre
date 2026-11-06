// =====================================
// LISTE DES MEMBRES (UNE SEULE LISTE) ET FICHE MODIFIABLE
// Chargé après app.js : remplace afficherMembres et ouvrirCarteMembre.
// =====================================
(function () {
    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dateFr = v => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "");

    function age(v) {
        const n = new Date(v);
        if (!v || isNaN(n)) return "";
        const a = new Date();
        let r = a.getFullYear() - n.getFullYear();
        if (a < new Date(a.getFullYear(), n.getMonth(), n.getDate())) r--;
        return `${r} ans`;
    }

    const pagination = document.getElementById("pagination-membres");
    if (pagination) pagination.style.display = "none";

    // ---------- Liste : tous les membres, sans pages ----------
    window.afficherMembres = function (membres) {
        const corps = document.getElementById("liste-membres");
        corps.replaceChildren();

        if (!membres.length) {
            corps.innerHTML = `<tr><td colspan="2">${
                tousLesMembres.length ? "Aucun membre ne correspond à la recherche." : "Aucun membre enregistré."
            }</td></tr>`;
            return;
        }

        const tries = [...membres].sort((a, b) =>
            `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr"));

        tries.forEach(m => {
            const ligne = document.createElement("tr");
            ligne.className = "ligne-membre";
            ligne.title = "Cliquer pour voir la fiche";
            ligne.innerHTML = `<td><strong>${esc(m.prenom)}</strong></td><td>${esc(m.nom)}</td>`;
            ligne.addEventListener("click", () => window.ouvrirCarteMembre(m));
            corps.appendChild(ligne);
        });
    };

    // ---------- Fiche du membre ----------
    window.ouvrirCarteMembre = function (membre) {
        const ancienne = document.getElementById("carte-membre");
        if (ancienne) ancienne.remove();

        const fond = document.createElement("div");
        fond.id = "carte-membre";
        fond.className = "fiche-fond";
        document.body.appendChild(fond);

        const fermer = () => {
            fond.remove();
            document.removeEventListener("keydown", touche);
        };
        const touche = e => { if (e.key === "Escape") fermer(); };
        document.addEventListener("keydown", touche);
        fond.addEventListener("click", e => { if (e.target === fond) fermer(); });

        let fonctionBureau = "";
        fetch("/api/bureau").then(r => r.json()).then(d => {
            const x = (d.bureau || []).find(b => String(b.membre_id) === String(membre.id));
            if (x) { fonctionBureau = `Bureau : ${x.fonction}`; const z = fond.querySelector(".fiche-bureau"); if (z) z.textContent = fonctionBureau; }
        }).catch(() => {});

        const entete = () => {
            const ini = `${(membre.prenom || "?")[0]}${(membre.nom || "")[0] || ""}`.toUpperCase();
            return `<div class="fiche-entete">
                <div class="fiche-avatar">${esc(ini)}</div>
                <h2>${esc(membre.prenom)} ${esc(membre.nom)}</h2>
                <p class="fiche-bureau">${esc(fonctionBureau)}</p>
            </div>`;
        };

        // --- Mode lecture ---
        const lecture = () => {
            const infos = [
                ["Sexe", membre.sexe], ["Date de naissance", dateFr(membre.date_naissance)],
                ["Âge", age(membre.date_naissance)], ["Téléphone", membre.telephone],
                ["E-mail", membre.email], ["Profession", membre.profession],
                ["Inscrit le", dateFr(membre.date_inscription)]
            ];
            fond.innerHTML = `<div class="fiche">${entete()}
                <div class="fiche-corps">${infos.map(([t, v]) => `
                    <div class="fiche-ligne"><span>${t}</span>
                    <strong>${v ? esc(v) : '<em>Non renseigné</em>'}</strong></div>`).join("")}</div>
                <div class="fiche-actions">
                    <button type="button" class="primary-button" id="fiche-modifier">Modifier</button>
                    <button type="button" id="fiche-supprimer" class="fiche-danger">Supprimer</button>
                    <button type="button" id="fiche-fermer">Fermer</button>
                </div></div>`;
            fond.querySelector("#fiche-fermer").onclick = fermer;
            fond.querySelector("#fiche-modifier").onclick = edition;
            fond.querySelector("#fiche-supprimer").onclick = supprimer;
        };

        // --- Mode modification ---
        const edition = () => {
            const champ = (id, titre, valeur, type = "text", extra = "") => `
                <div class="fiche-champ"><label for="${id}">${titre}</label>
                <input id="${id}" type="${type}" value="${esc(valeur)}" ${extra}></div>`;
            fond.innerHTML = `<div class="fiche">${entete()}
                <div class="fiche-corps">
                    ${champ("fe-prenom", "Prénom *", membre.prenom)}
                    ${champ("fe-nom", "Nom *", membre.nom)}
                    <div class="fiche-champ"><label for="fe-sexe">Sexe *</label>
                        <select id="fe-sexe">
                            <option ${membre.sexe === "Masculin" ? "selected" : ""}>Masculin</option>
                            <option ${membre.sexe === "Féminin" ? "selected" : ""}>Féminin</option>
                        </select></div>
                    ${champ("fe-naissance", "Date de naissance", (membre.date_naissance || "").slice(0, 10), "date")}
                    ${champ("fe-tel", "Téléphone (9 chiffres)", membre.telephone || "", "tel", 'maxlength="9" inputmode="numeric"')}
                    ${champ("fe-email", "Adresse e-mail", membre.email || "", "email")}
                    ${champ("fe-profession", "Profession", membre.profession || "")}
                </div>
                <div class="fiche-actions">
                    <button type="button" class="primary-button" id="fiche-enregistrer">Enregistrer</button>
                    <button type="button" id="fiche-annuler">Annuler</button>
                </div></div>`;
            fond.querySelector("#fiche-annuler").onclick = lecture;
            fond.querySelector("#fiche-enregistrer").onclick = enregistrer;
        };

        const enregistrer = async () => {
            const v = id => fond.querySelector("#" + id).value.trim();
            const donnees = {
                prenom: v("fe-prenom"), nom: v("fe-nom"), sexe: v("fe-sexe"),
                date_naissance: v("fe-naissance") || null,
                telephone: v("fe-tel") || null, email: v("fe-email") || null,
                profession: v("fe-profession")
            };
            if (!donnees.prenom || !donnees.nom) return alert("Le prénom et le nom sont obligatoires.");
            if (!donnees.telephone && !donnees.email)
                return alert("Il faut renseigner au moins un contact : téléphone ou e-mail.");
            if (donnees.telephone && !/^[0-9]{9}$/.test(donnees.telephone))
                return alert("Le téléphone doit contenir exactement 9 chiffres.");
            if (donnees.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donnees.email))
                return alert("L'adresse e-mail n'est pas valide.");
            try {
                const r = await fetch(`/api/membres/${membre.id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(donnees)
                });
                const res = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(res.message || res.erreur || "Modification impossible.");
                Object.assign(membre, donnees);
                lecture();
                chargerMembres();
            } catch (e) { alert(e.message); }
        };

        const supprimer = async () => {
            if (!confirm(`Voulez-vous vraiment supprimer ${membre.prenom} ${membre.nom} ? Cette action est irréversible.`)) return;
            try {
                const r = await fetch(`/api/membres/${membre.id}`, { method: "DELETE" });
                const res = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(res.message || res.erreur || "Suppression impossible.");
                fermer();
                chargerMembres();
            } catch (e) { alert(e.message); }
        };

        lecture();
    };

    // Rafraîchit l'affichage avec la nouvelle présentation
    if (typeof tousLesMembres !== "undefined" && tousLesMembres.length) {
        window.afficherMembres(tousLesMembres);
    }
})();
