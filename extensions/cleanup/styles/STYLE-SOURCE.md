# Herkunft der Cleanup-Stilquelle

Der Cleanup-Modus misst sich am Coding-Style des Linux-Kernels. Die Datei liegt
bewusst als Repo-Asset bei und wird **nicht** über einen lokalen Pfad
referenziert — ein Pfad wie `C:\Users\…\coding-style.rst` existiert nur auf
einem Rechner und wäre in einem geteilten Repo oder Pi-Paket wertlos.

| Feld | Wert |
|---|---|
| Datei | `linux-kernel-coding-style.rst` |
| Upstream | https://github.com/torvalds/linux/blob/master/Documentation/process/coding-style.rst |
| Roh-URL | https://raw.githubusercontent.com/torvalds/linux/master/Documentation/process/coding-style.rst |
| Zeilen | 1294 |
| SHA-256 | `332454d2ab9a0462dd9f292c52291cf3b5e1afcd638aa06df15f557c47a126f5` |
| Upstream-Commit | *unbekannt* — die Kopie wurde ohne Ref übernommen |
| Lizenz | GPL-2.0 (Linux-Kernel-Dokumentation) |

## Abweichung von der Upstream-Fassung

Zeile 1 lautete in der übernommenen Kopie `x.. _codingstyle:` statt
`.. _codingstyle:` (ein verirrtes `x` am Zeilenanfang). Das ist korrigiert.
Ansonsten ist die Datei unverändert.

## Aktualisieren

```bash
bash scripts/update-coding-style.sh          # holt master, zeigt den Diff
bash scripts/update-coding-style.sh --apply  # übernimmt ihn
```

Das Skript schreibt Commit-Hash und neue Prüfsumme in diese Tabelle zurück,
sodass die Fassung ab dem ersten Lauf gepinnt ist.

## Lizenzhinweis

Die Kernel-Dokumentation steht unter GPL-2.0. Solange Syntax Bot diese Datei
mitliefert, muss die Lizenzfrage des Repos das berücksichtigen — sie ist in
`Syntax-Bot-Specification.md` noch als offener Punkt geführt. Alternative, falls
das Repo nicht GPL-kompatibel werden soll: die Datei beim ersten Start
herunterladen statt sie einzuchecken.
