# Ligne K → RER B CDG 1

Version web du widget Scriptable, prête pour **GitHub Pages**.

## Installation

1. Créer un dépôt GitHub, par exemple `ligne-k-rer-b`.
2. Déposer à la racine : `index.html`, `styles.css`, `app.js` et `.nojekyll`.
3. Dans **Settings → Pages**, choisir **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. Ouvrir l’URL GitHub Pages affichée par GitHub.
5. Cliquer sur **Clé API** et saisir une clé PRIM valide.

La clé est enregistrée dans le `localStorage` du navigateur. Elle n’est donc pas présente dans le dépôt, mais reste consultable sur l’appareil par une personne ayant accès aux outils de développement. Pour une diffusion réellement publique, utiliser un backend/proxy afin de garder le secret côté serveur.

## Utilisation

- **Aujourd’hui** : recherche de la Ligne K autour de 08:10.
- **Demain** : même recherche le lendemain ; l’URL reçoit `?mode=P`.
- Actualisation automatique toutes les 2 minutes et au retour sur l’onglet.
- La destination CDG 1 est découverte automatiquement puis mémorisée localement.

## Sécurité

La clé initialement incluse dans le script Scriptable a été volontairement retirée. Comme elle a été partagée en clair, il est recommandé de la révoquer ou de la régénérer sur PRIM avant mise en ligne.
