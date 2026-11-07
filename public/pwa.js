// =====================================
// APPLICATION INSTALLABLE ET MODE HORS LIGNE
// =====================================
(function () {
    const CLE = "fogny_file_attente";

    // ---------- File d'attente des envois faits hors ligne ----------
    const lire = () => { try { return JSON.parse(localStorage.getItem(CLE)) || []; } catch (e) { return []; } };
    const ecrire = f => localStorage.setItem(CLE, JSON.stringify(f));

    let enCours = false;
    async function synchroniser() {
        if (enCours || !navigator.onLine) return;
        enCours = true;
        let envoyes = 0, bloque = false;
        try {
            let file = lire();
            while (file.length) {
                const el = file[0];
                let reponse;
                try {
                    reponse = await fetch(el.url, {
                        method: el.methode || "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(el.corps)
                    });
                } catch (e) { break; }          // réseau perdu : on réessaiera
                if (reponse.status === 401) { bloque = true; break; }   // session expirée
                file.shift();                    // envoyé, ou refusé définitivement
                ecrire(file);
                if (reponse.ok) envoyes++;
            }
        } finally { enCours = false; }
        majBandeau(envoyes, bloque);
    }

    window.FileAttente = {
        ajouter(element) {
            const file = lire();
            file.push(element);
            ecrire(file);
            majBandeau();
        },
        synchroniser
    };

    // ---------- Bandeau d'état ----------
    const bandeau = document.createElement("div");
    bandeau.id = "bandeau-hors-ligne";
    bandeau.setAttribute("role", "status");
    document.body.appendChild(bandeau);

    function majBandeau(envoyes = 0, bloque = false) {
        const attente = lire().length;
        let texte = "";
        if (!navigator.onLine) {
            texte = "Hors ligne : consultation possible" +
                (attente ? ` · ${attente} envoi(s) en attente` : "");
        } else if (bloque) {
            texte = `${attente} envoi(s) en attente : reconnectez-vous pour les envoyer.`;
        } else if (attente) {
            texte = `${attente} envoi(s) en attente de synchronisation...`;
        } else if (envoyes) {
            texte = `Connexion rétablie : ${envoyes} envoi(s) synchronisé(s).`;
            setTimeout(() => majBandeau(), 4000);
        }
        bandeau.textContent = texte;
        bandeau.classList.toggle("visible", Boolean(texte));
        bandeau.classList.toggle("hors-ligne", !navigator.onLine);
    }

    window.addEventListener("online", () => { majBandeau(); synchroniser(); });
    window.addEventListener("offline", () => majBandeau());
    majBandeau();
    synchroniser();

    // ---------- Service worker ----------
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js").catch(() => {});
        });
    }

    // ---------- Bouton « Installer l'application » ----------
    let invite = null;
    window.addEventListener("beforeinstallprompt", e => {
        e.preventDefault();
        invite = e;
        if (document.getElementById("bouton-installer")) return;
        const bouton = document.createElement("button");
        bouton.id = "bouton-installer";
        bouton.type = "button";
        bouton.textContent = "📲 Installer l'application";
        bouton.addEventListener("click", async () => {
            if (!invite) return;
            invite.prompt();
            await invite.userChoice;
            invite = null;
            bouton.remove();
        });
        const deconnexion = document.getElementById("bouton-deconnexion");
        if (deconnexion && deconnexion.parentNode) deconnexion.parentNode.insertBefore(bouton, deconnexion);
    });
    window.addEventListener("appinstalled", () => {
        const b = document.getElementById("bouton-installer");
        if (b) b.remove();
    });
})();
