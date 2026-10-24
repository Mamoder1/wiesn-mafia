# Mafia – Wiesn-Edition

Mafia als Partyspiel im Oktoberfest-Zelt. Jeder spielt am eigenen Handy, ohne Anmeldung.

## Architektur
- Statische Website (GitHub Pages), installierbar als PWA.
- Das Handy, das den Raum erstellt, ist **Host** und führt die komplette Spiellogik aus (`js/host.js`).
- Alle Handys sind über öffentliche MQTT-Broker (WebSocket, TLS) verbunden (`js/bus.js`):
  - `wm1/<RAUM>/s`: öffentlicher Spielstand (retained)
  - `wm1/<RAUM>/p/<id>`: privater Stand pro Spieler (Rolle, Nachtaufgabe), retained
  - `wm1/<RAUM>/in`: Eingaben der Spieler an den Host
  - `wm1/<RAUM>/hb`: Heartbeat des Hosts
- Reine Spielregeln in `js/engine.js` (ohne DOM und Netzwerk).

## Spielmechaniken
- Abstimmung geheim, nach dem Schließen sieht jeder, wer wen gewählt hat.
- Geheimaufträge (abschaltbar): Bierdiebe bekommen morgens 3 zufällige unauffällige Aufträge und wählen freiwillig einen davon. Erledigt vor Start der Abstimmung = in der folgenden Nacht vor dem Ordner getarnt (Ehrensystem).

- Optionale Rollen: Gaudibursch, Bedienung (Ziel darf am Tag nicht abstimmen), Hendlbrater (einmal im Spiel ein Rauswurf, Sanitäter schützt auch davor).
- Wiesn-Ereignisse (abschaltbar), jedes ändert die Regeln für den Tag: Regenschauer, Blaskapellenpause, Stromausfall, Durchsage, Schichtwechsel, Enthaltungsverbot.
- Rückblick am Spielende: komplette Zeitleiste aller Nächte und Tage.

- Admin-Modus (Lobby: „Ich spiele selbst mit“ aus): Der Spielleiter bekommt keine Rolle und sieht auf seinem Handy alle Rollen, Nachtaktionen, Stimmen und Geheimaufträge. Erledigte Aufträge zählen erst, wenn er sie bestätigt. Die Übersicht wird nur lokal angezeigt und nie übers Netz verschickt.

## Tests
```
node tests/engine.test.mjs                       # Regeln
node tests/host.test.mjs                         # Host: Tarnung, geheime Abstimmung
python3 -m http.server 8765 & node tests/sim.cjs # 7 Handys spielen 3 komplette Partien (lokaler Bus)
```
Die Simulation prüft außerdem, dass keine Rolle eines lebenden Spielers im öffentlichen Kanal steht.

## Bekannte Grenzen
- Öffentliche Broker: Wer technisch versiert ist, könnte mitlesen. Für eine Partyrunde okay.
- Das Host-Handy muss offen bleiben. Lädt es neu, wird der Spielstand wiederhergestellt.
