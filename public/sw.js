// Registre Fogny : service worker (installation + mode hors ligne)
// Changer le numéro de version ci-dessous force la mise à jour des fichiers en cache.
const VERSION = "fogny-v7";
const FICHIERS = [
    "/style.css", "/theme-pro.css", "/police.css", "/app.js", "/acces.js", "/pointages.js", "/supervisions.js",
    "/rapports.js", "/reunions.js", "/categories.js", "/programme-categories.js",
    "/membres-liste.js", "/niveaux.js", "/cours.js", "/membres-import.js", "/comptes.js", "/droits.js", "/profil.js", "/pwa.js", "/manifest.webmanifest",
    "/icons/icon-192.png", "/icons/icon-512.png"
];
const BIBLIOTHEQUES = [
    "https://cdn.jsdelivr.net/npm/chart.js",
    "https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2",
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
];

self.addEventListener("install", evenement => {
    evenement.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        await Promise.all(FICHIERS.map(u => cache.add(u).catch(() => {})));
        await Promise.all(BIBLIOTHEQUES.map(u =>
            fetch(u, { mode: "no-cors" }).then(r => cache.put(u, r)).catch(() => {})));
        self.skipWaiting();
    })());
});

self.addEventListener("activate", evenement => {
    evenement.waitUntil((async () => {
        const noms = await caches.keys();
        await Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

const reponseHorsLigne = () => new Response(
    JSON.stringify({ succes: false, message: "Hors ligne : ces données n'ont pas encore été chargées sur cet appareil." }),
    { status: 503, headers: { "Content-Type": "application/json" } });

async function reseauPuisCache(requete, cleCache) {
    const cache = await caches.open(VERSION);
    try {
        const reponse = await fetch(requete);
        if (reponse.ok && !reponse.redirected) cache.put(cleCache || requete, reponse.clone());
        return reponse;
    } catch (e) {
        return (await cache.match(cleCache || requete)) || null;
    }
}

self.addEventListener("fetch", evenement => {
    const requete = evenement.request;
    if (requete.method !== "GET") return;
    const url = new URL(requete.url);

    // Bibliothèques externes : cache d'abord
    if (url.origin !== location.origin) {
        if (BIBLIOTHEQUES.includes(requete.url)) {
            evenement.respondWith(caches.match(requete.url).then(c => c || fetch(requete)));
        }
        return;
    }

    // Données : réseau d'abord, dernière copie en secours
    if (url.pathname.startsWith("/api/")) {
        evenement.respondWith(reseauPuisCache(requete).then(r => r || reponseHorsLigne()));
        return;
    }

    // Pages : réseau d'abord, page enregistrée en secours
    if (requete.mode === "navigate") {
        evenement.respondWith((async () => {
            const r = await reseauPuisCache(requete, url.pathname);
            return r || (await caches.match("/")) || Response.error();
        })());
        return;
    }

    // Fichiers de l'application : version en cache, mise à jour en arrière-plan
    evenement.respondWith((async () => {
        const cache = await caches.open(VERSION);
        const enCache = await cache.match(requete);
        const reseau = fetch(requete).then(r => {
            if (r.ok) cache.put(requete, r.clone());
            return r;
        }).catch(() => null);
        return enCache || (await reseau) || Response.error();
    })());
});
