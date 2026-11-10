// =====================================
// DROITS : ADAPTE LE MENU ET LES BOUTONS AUX PERMISSIONS DE L'UTILISATEUR
// =====================================
(function () {
    // [rubrique, permissions dont UNE suffit ("admin" = administrateurs seulement)]
    const REGLES = [
        ["dashboard", ["membres.voir"]],
        ["membres", ["membres.voir"]],
        ["programme", ["programme.voir"]],
        ["pointages", ["pointages.gerer"]],
        ["cours", ["cours.voir", "cours.gerer"]],
        ["supervisions", ["supervisions.voir"]],
        ["rapports", ["rapports.voir"]],
        ["reunions", ["reunions.voir", "reunions.gerer"]],
        ["gestion-bureau", ["bureau.gerer"]],
        ["acces", "admin"],
        ["comptes", "admin"]
    ];

    const interdire = element => { if (element) element.setAttribute("data-interdit", ""); };

    fetch("/api/mes-permissions")
        .then(r => r.json())
        .then(d => {
            if (!d || !d.succes) return;
            const codes = new Set(d.permissions);
            const admin = d.administrateur === true;

            window.DROITS = { admin, peut: code => admin || codes.has(code) };
            document.body.classList.toggle("droit-admin", admin);
            (d.permissions || []).forEach(c =>
                document.body.classList.add("droit-" + c.replace(/\./g, "-")));

            REGLES.forEach(([id, exigees]) => {
                const autorise = admin || (exigees !== "admin" && exigees.some(c => codes.has(c)));
                if (autorise) return;
                interdire(document.querySelector(`.nav-link[href="#${id}"]`));
                interdire(document.getElementById(id));
            });
            if (!window.DROITS.peut("programme.voir")) interdire(document.getElementById("sous-menu-programme"));

            // Si la rubrique ouverte n'est pas autorisée, ouvrir la première qui l'est
            const active = document.querySelector(".nav-link.active");
            if (!active || active.hasAttribute("data-interdit")) {
                const premiere = [...document.querySelectorAll(".sidebar-nav .nav-link")]
                    .find(l => !l.hasAttribute("data-interdit"));
                if (premiere) premiere.click();
            }
        })
        .catch(() => {});
})();
