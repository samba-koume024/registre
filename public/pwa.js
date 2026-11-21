// =====================================
// APPLICATION INSTALLABLE ET MODE HORS LIGNE
// - Hors ligne, toutes les modifications de saisie restent possibles : elles sont gardées
//   sur l'appareil (service worker) puis envoyées automatiquement au retour de la connexion.
// =====================================
(function () {
    const CLE = "fogny_file_attente";           // ancienne file (secours si le service worker est absent)

    // ---------- Ancienne file d'attente (secours) ----------
    const lire = () => { try { return JSON.parse(localStorage.getItem(CLE)) || []; } catch (e) { return []; } };
    const ecrire = f => localStorage.setItem(CLE, JSON.stringify(f));

    let enCours = false;
    async function synchroniserSecours() {
        if (enCours || !navigator.onLine) return;
        enCours = true;
        try {
            const file = lire();
            while (file.length) {
                const el = file[0];
                let reponse;
                try {
                    reponse = await fetch(el.url, {
                        method: el.methode || "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(el.corps)
                    });
                } catch (e) { break; }
                if (reponse.status === 401) break;
                file.shift();
                ecrire(file);
            }
        } finally { enCours = false; }
        majBandeau();
    }

    window.FileAttente = {
        ajouter(element) {
            const file = lire();
            file.push(element);
            ecrire(file);
            majBandeau();
        },
        synchroniser: synchroniserSecours
    };

    // ---------- Bandeau d'état ----------
    const bandeau = document.createElement("div");
    bandeau.id = "bandeau-hors-ligne";
    bandeau.setAttribute("role", "status");
    document.body.appendChild(bandeau);

    let restants = 0;          // modifications en attente (service worker)
    let echecs = [];           // modifications refusées par le serveur
    let connexionRequise = false;
    let message = "";

    function majBandeau() {
        const attente = restants + lire().length;
        let texte = "";
        let alerte = false;

        if (echecs.length) {
            texte = `${echecs.length} modification(s) refusée(s) par le serveur. Cliquez ici pour les voir.`;
            alerte = true;
        } else if (!navigator.onLine) {
            texte = "Hors ligne : vous pouvez continuer à modifier." +
                (attente ? ` ${attente} modification(s) en attente d'envoi.` : "");
        } else if (connexionRequise && attente) {
            texte = `${attente} modification(s) en attente : reconnectez-vous pour les envoyer.`;
            alerte = true;
        } else if (attente) {
            texte = `${attente} modification(s) en cours d'envoi...`;
        } else if (message) {
            texte = message;
        }

        bandeau.textContent = texte;
        bandeau.classList.toggle("visible", Boolean(texte));
        bandeau.classList.toggle("hors-ligne", !navigator.onLine || alerte);
        bandeau.style.cursor = echecs.length ? "pointer" : "";
    }

    bandeau.addEventListener("click", () => {
        if (!echecs.length) return;
        const detail = echecs.map(e => {
            const rubrique = (e.url.split("/api/")[1] || "").split(/[/?]/)[0] || "donnée";
            return `• ${e.methode} ${rubrique} : ${e.message}`;
        }).join("\n");
        alert("Ces modifications faites hors ligne ont été refusées par le serveur et n'ont pas été enregistrées :\n\n" +
            detail + "\n\nVérifiez les informations concernées, puis refaites-les si nécessaire.");
        envoyerAuSW({ type: "vider-echecs" });
    });

    // ---------- Dialogue avec le service worker ----------
    function envoyerAuSW(msg) {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(msg);
        }
    }

    function rafraichirAffichage() {
        // Recharge la rubrique ouverte, sauf si une saisie est en cours
        if (document.querySelector(".fiche-fond")) return;
        const el = document.activeElement;
        if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
        const actif = document.querySelector(".nav-link.active");
        if (actif) actif.click();
    }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", e => {
            const d = e.data || {};
            if (d.type !== "etat") return;
            restants = d.restants || 0;
            echecs = d.echecs || [];
            connexionRequise = Boolean(d.connexionRequise);
            if (d.envoyes) {
                message = `Connexion rétablie : ${d.envoyes} modification(s) envoyée(s).`;
                setTimeout(() => { message = ""; majBandeau(); }, 5000);
                rafraichirAffichage();
            }
            majBandeau();
        });

        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready)
                .then(() => { envoyerAuSW({ type: "etat" }); envoyerAuSW({ type: "rejouer" }); })
                .catch(() => {});
        });
    }

    window.addEventListener("online", () => {
        majBandeau();
        envoyerAuSW({ type: "rejouer" });
        synchroniserSecours();
        precharger();
    });
    window.addEventListener("offline", () => majBandeau());
    majBandeau();
    synchroniserSecours();

    // ---------- Préchargement des données pour le travail hors ligne ----------
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    const derniereDate = jour => {
        const d = new Date();
        const i = JOURS.indexOf(jour);
        if (i >= 0) d.setDate(d.getDate() - ((d.getDay() - i + 7) % 7));
        return d.toLocaleDateString("fr-CA");
    };
    const lireJson = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

    async function precharger() {
        if (!navigator.onLine) return;
        const [programme, , , , cours, niveaux, reunions] = await Promise.all([
            lireJson("/api/programme"), lireJson("/api/membres"), lireJson("/api/bureau"),
            lireJson("/api/programme-categories"), lireJson("/api/cours"), lireJson("/api/niveaux"),
            lireJson("/api/reunions"), lireJson("/api/mes-permissions"), lireJson("/api/moi"),
            lireJson("/api/membres-inactifs")
        ]);

        // Appel et informations de la dernière séance de chaque activité
        if (Array.isArray(programme)) {
            for (const a of programme.slice(0, 40)) {
                const q = `date=${encodeURIComponent(derniereDate(a.jour))}&activite=${encodeURIComponent(a.activite)}`;
                await Promise.all([lireJson(`/api/pointages?${q}`), lireJson(`/api/pointage-infos?${q}`)]);
            }
        }
        // Évaluations de chaque cours et niveau
        if (cours && niveaux && Array.isArray(cours.cours)) {
            for (const c of cours.cours.slice(0, 20)) {
                for (const n of (niveaux.niveaux || [])) {
                    await lireJson(`/api/evaluations?programme_id=${encodeURIComponent(c.programme_id)}&niveau=${encodeURIComponent(n.nom)}`);
                }
            }
        }
        // Dernières réunions
        if (reunions && Array.isArray(reunions.reunions)) {
            for (const r of reunions.reunions.slice(0, 20)) await lireJson(`/api/reunions/${r.id}`);
        }
    }

    setTimeout(precharger, 2500);
    setInterval(precharger, 15 * 60 * 1000);

    // ---------- Déconnexion : envoyer ce qui reste, puis effacer les données de l'appareil ----------
    const boutonDeconnexion = document.getElementById("bouton-deconnexion");
    if (boutonDeconnexion) {
        boutonDeconnexion.addEventListener("click", () => envoyerAuSW({ type: "deconnexion" }));
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
        const profil = document.getElementById("profil-menu");
        if (profil && profil.parentNode) profil.parentNode.insertBefore(bouton, profil);
    });
    window.addEventListener("appinstalled", () => {
        const b = document.getElementById("bouton-installer");
        if (b) b.remove();
    });
})();
