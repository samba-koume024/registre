// =====================================
// PROFIL DE L'UTILISATEUR DANS LE MENU
// =====================================
(function () {
    const bouton = document.getElementById("profil-bouton");
    const liste = document.getElementById("profil-liste");
    if (!bouton || !liste) return;

    const definir = ouvert => {
        liste.hidden = !ouvert;
        bouton.setAttribute("aria-expanded", String(ouvert));
    };

    bouton.addEventListener("click", e => {
        e.stopPropagation();
        definir(liste.hidden);
    });
    document.addEventListener("click", e => {
        if (!document.getElementById("profil-menu").contains(e.target)) definir(false);
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") definir(false); });

    fetch("/api/moi")
        .then(r => r.json())
        .then(d => {
            if (!d || !d.succes) return;
            document.getElementById("profil-initiales").textContent = d.initiales;
            document.getElementById("profil-nom").textContent = d.nom_affiche;
            document.getElementById("profil-role").textContent = d.role;
        })
        .catch(() => {});
})();
