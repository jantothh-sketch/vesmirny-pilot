# Vesmírny pilot

Farebná 2D vzdelávacia browser hra pre deti vo veku 8-12 rokov. Hráč pilotuje vesmírnu loď a cez krátke misie sa učí orientáciu na klávesnici.

## Spustenie

```bash
npm install
npm run dev
```

Potom otvor lokálnu adresu, ktorú vypíše Vite, zvyčajne:

```text
http://127.0.0.1:5173/
```

## Build

```bash
npm run build
```

## Ovládanie

- `↑` / `↓` výber v menu
- `Enter` potvrdenie
- `Escape` návrat späť
- písmená, šípky, `Space`, `Shift`, `Tab`, `Backspace` podľa aktuálnej misie

## Obsah prototypu

- hlavné menu
- výber úrovní
- nastavenia zvuku
- 7 klávesnicových misií
- body, hviezdičky, hodnosti
- autosave cez `localStorage`
- grafika kreslená priamo v Phaser canvas-e
