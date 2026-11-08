// =====================================
// IMPORT DE MEMBRES DEPUIS UN FICHIER EXCEL
// =====================================
(function () {
    const COLONNES = ["Prénom", "Nom", "Sexe", "Date de naissance", "Téléphone", "E-mail", "Profession"];
    const bouton = document.getElementById("bouton-importer");
    const zone = document.getElementById("import-membres");
    if (!bouton || !zone) return;

    const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const cle = t => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z]/g, "");

    const ALIAS = {
        prenom: "prenom", nom: "nom", sexe: "sexe", genre: "sexe",
        datedenaissance: "date_naissance", naissance: "date_naissance", datenaissance: "date_naissance",
        telephone: "telephone", tel: "telephone", numero: "telephone",
        email: "email", courriel: "email", mail: "email", adresseemail: "email",
        profession: "profession", metier: "profession"
    };

    let valides = [];

    // ---------- Conversions ----------
    function convertirDate(v) {
        if (v === "" || v === null || v === undefined) return "";
        if (typeof v === "number" && window.XLSX) {
            const d = XLSX.SSF.parse_date_code(v);
            return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "";
        }
        if (v instanceof Date) {
            return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
        }
        const t = String(v).trim();
        let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
        m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        return t;
    }

    function convertirSexe(v) {
        const t = cle(v);
        if (["m", "h", "masculin", "homme", "garcon"].includes(t)) return "Masculin";
        if (["f", "feminin", "femme", "fille"].includes(t)) return "Féminin";
        return String(v ?? "").trim();
    }

    function convertirTelephone(v) {
        let chiffres = String(v ?? "").replace(/\D/g, "");
        if (chiffres.length === 12 && chiffres.startsWith("221")) chiffres = chiffres.slice(3);
        return chiffres;
    }

    // ---------- Contrôle d'une ligne ----------
    function controler(l) {
        if (!l.prenom || !l.nom) return "prénom ou nom manquant";
        if (l.sexe !== "Masculin" && l.sexe !== "Féminin") return "sexe invalide (Masculin ou Féminin)";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date_naissance) || isNaN(Date.parse(l.date_naissance))) return "date de naissance invalide";
        if (!l.telephone && !l.email) return "téléphone ou e-mail nécessaire";
        if (l.telephone && !/^\d{9}$/.test(l.telephone)) return "téléphone : 9 chiffres attendus";
        if (l.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) return "e-mail invalide";
        return "";
    }

    // ---------- Interface ----------
    function afficherPanneau() {
        valides = [];
        zone.hidden = false;
        zone.className = "content-card";
        zone.innerHTML = `
            <h3>Importer des membres depuis Excel</h3>
            <p>Le fichier doit contenir une ligne d'en-têtes : <strong>${COLONNES.join(" · ")}</strong>.
            Prénom, nom, sexe, date de naissance et un contact (téléphone ou e-mail) sont obligatoires.
            Les membres déjà présents (même téléphone, e-mail ou identité) sont ignorés.</p>
            <p>
                <input type="file" id="imp-fichier" accept=".xlsx,.xls,.csv">
                <button type="button" id="imp-modele">Télécharger le modèle</button>
                <button type="button" id="imp-fermer">Fermer</button>
            </p>
            <div id="imp-apercu"></div>`;
        document.getElementById("imp-fermer").onclick = () => { zone.hidden = true; zone.innerHTML = ""; };
        document.getElementById("imp-modele").onclick = telechargerModele;
        document.getElementById("imp-fichier").onchange = lireFichier;
        zone.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function telechargerModele() {
        if (typeof XLSX === "undefined") return alert("La bibliothèque Excel n'est pas disponible (connexion internet requise).");
        const feuille = XLSX.utils.aoa_to_sheet([
            COLONNES,
            ["Amadou", "Diop", "Masculin", "15/03/1998", "771234567", "amadou@email.com", "Étudiant"]
        ]);
        const classeur = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(classeur, feuille, "Membres");
        XLSX.writeFile(classeur, "modele-import-membres.xlsx");
    }

    async function lireFichier(e) {
        const fichier = e.target.files[0];
        const apercu = document.getElementById("imp-apercu");
        if (!fichier) return;
        if (typeof XLSX === "undefined") {
            apercu.textContent = "La bibliothèque Excel n'est pas disponible (connexion internet requise).";
            return;
        }
        try {
            const classeur = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
            const feuille = classeur.Sheets[classeur.SheetNames[0]];
            const brut = XLSX.utils.sheet_to_json(feuille, { defval: "", raw: true });
            if (!brut.length) { apercu.textContent = "Le fichier est vide."; return; }

            const lignes = brut.map((ligne, i) => {
                const l = { ligne: i + 2, prenom: "", nom: "", sexe: "", date_naissance: "", telephone: "", email: "", profession: "" };
                Object.keys(ligne).forEach(colonne => {
                    const champ = ALIAS[cle(colonne)];
                    if (champ) l[champ] = ligne[colonne];
                });
                l.prenom = String(l.prenom).trim();
                l.nom = String(l.nom).trim();
                l.sexe = convertirSexe(l.sexe);
                l.date_naissance = convertirDate(l.date_naissance);
                l.telephone = convertirTelephone(l.telephone);
                l.email = String(l.email).trim().toLowerCase();
                l.profession = String(l.profession).trim();
                l.erreur = controler(l);
                return l;
            });

            valides = lignes.filter(l => !l.erreur);
            const invalides = lignes.filter(l => l.erreur);

            apercu.innerHTML = `
                <p><strong>${valides.length}</strong> ligne(s) prête(s) à importer ·
                <strong>${invalides.length}</strong> ligne(s) à corriger.</p>
                ${invalides.length ? `<div class="table-container"><table>
                    <thead><tr><th>Ligne</th><th>Membre</th><th>Problème</th></tr></thead>
                    <tbody>${invalides.slice(0, 50).map(l => `<tr><td>${l.ligne}</td>
                        <td>${esc(l.prenom)} ${esc(l.nom)}</td><td>${esc(l.erreur)}</td></tr>`).join("")}</tbody>
                </table></div>${invalides.length > 50 ? "<small>Seules les 50 premières erreurs sont affichées.</small>" : ""}` : ""}
                ${valides.length ? `<p><button type="button" class="primary-button" id="imp-lancer">
                    Importer ${valides.length} membre(s)</button></p>` : ""}`;
            const lancer = document.getElementById("imp-lancer");
            if (lancer) lancer.onclick = importer;
        } catch (erreur) {
            console.error(erreur);
            apercu.textContent = "Impossible de lire ce fichier. Utilisez un fichier Excel (.xlsx) ou CSV.";
        }
    }

    async function importer() {
        const lancer = document.getElementById("imp-lancer");
        lancer.disabled = true;
        try {
            const reponse = await fetch("/api/membres/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ membres: valides.map(({ erreur, ...l }) => l) })
            });
            const res = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(res.message || "Importation impossible.");

            const ignores = res.ignores || [];
            document.getElementById("imp-apercu").innerHTML = `
                <p><strong>${res.importes}</strong> membre(s) importé(s).
                ${ignores.length ? `<strong>${ignores.length}</strong> ignoré(s) :` : ""}</p>
                ${ignores.length ? `<ul>${ignores.slice(0, 50).map(i =>
                    `<li>Ligne ${i.ligne} : ${esc(i.raison)}</li>`).join("")}</ul>` : ""}`;
            if (typeof chargerMembres === "function") chargerMembres();
        } catch (e) {
            alert(e.message);
            lancer.disabled = false;
        }
    }

    bouton.addEventListener("click", () => {
        if (zone.hidden) afficherPanneau();
        else { zone.hidden = true; zone.innerHTML = ""; }
    });
})();
