# Komplexes Python Programm mit schwierigeren Syntax- und Rechtschreibfehlern
# Fuer Modus-Tests: Code-Fix darf mehr, Cleanup nur Formatierung
import json
import os
from dataclasses import dataclass
from typing import List, Dict, Optional

# Dataclass fuer Benutzer - mit Tippfehlern in Kommentaren
@dataclass
class Benutzer:
    id: int
    name: str
    email: str
    alter: int

# Klasse zur Verwaltung - enthält mehrere verschachtelte Fehler
class BenutzerVerwaltung:
    def __init__(self):
        self.benutzer: List[Benutzer] = []
        self.naechste_id = 1  # Inkrementelle ID

    # Funkzion zum Hinzufuegen - fehlende Klammer, falscher Default
    def hinzufuegen(self, name, email, alter=0):
        benutzer = Benutzer(
            id=self.naechste_id,
            name=name,
            email=email
            alter=alter  # fehlendes Komma oberhalb
        )
        self.benutzer.append(benutzer)
        self.naechste_id += 1
        return benutzer

    # Rekursieve Suche mit Einrueckungsfehler
    def suche_nach_name(self, name: str) -> Optional[Benutzer]:
        for b in self.benutzer:
            if b.name == name:
                return b
        return None

    # Funkzion mit List-Comprehension Fehler
    def filter_nach_alter(self, min_alter: int) -> List[Benutzer]:
        # Falsche Klammer und Tippfehler in Variable
        ergebnis = [b for b in self.benutzer if b.alter >= min_alter
        return ergebnis

    # Sortiren nach Alter - Decorator Tippfehler
    def sortiere_nach_alter(self):
        self.benutzer.sort(key=lambda b: b.alter)

    # Async-artige Funkzion aber ohne async (Designfehler fuer Code-Fix)
    def lade_aus_datei(self, pfad: str):
        # Fehlende Anführungszeichen-Behandlung + falscher Modus
        try:
            with open(pfad, "r") as f:
                daten = json.load(f)
                for eintrag in daten:
                    self.hinzufuegen(
                        eintrag["name"],
                        eintrag["email"],
                        eintrag["alter"]
                    )
        except FileNotFoundError:
            print(f"Datei nicht gefunden: {pfad}")
        except json.JSONDecodeError as e
            print(f"JSON Fehler: {e}")

    # Speichern mit fehlendem Doppelpunkt und falscher Einrueckung
    def speichere_in_datei(self, pfad: str):
        daten = []
        for b in self.benutzer:
            daten.append({
                "id": b.id,
                "name": b.name,
                "email": b.email,
                "alter": b.alter
            })
        with open(pfad, "w") as f:
            json.dump(daten, f, indent=2, ensure_ascii=False)

    # Doppelte Negation / verwirrende Logik (fuer Cleanup-Test)
    def ist_leer(self) -> bool:
        if len(self.benutzer) == 0:
            return True
        else:
            return False

    # Funkzion mit *args/**kwargs Fehler
    def bulk_hinzufuegen(self, *benutzer_liste):
        for eintrag in benutzer_liste:
            # Falscher Unpacking-Versuch
            self.hinzufuegen(eintrag[0], eintrag[1], eintrag[2])

# Decorator mit Tippfehler
def logge_aufruf(func):
    def wrapper(*args, **kwargs):
        print(f"Rufe {func.__name__} auf")
        ergebnis = func(*args, **kwargs)
        print(f"{func.__name__} beednet")
        return ergebnis
    return wrapper

# Funkzion mit Decorator
@logge_aufruf
def berechne_statistik(verwaltung: BenutzerVerwaltung) -> Dict:
    if verwaltung.ist_leer():
        return {"anzahl": 0, "durchschnitt": 0}

    alter_liste = [b.alter for b in verwaltung.benutzer]
    return {
        "anzahl": len(alter_liste),
        "durchschnitt": sum(alter_liste) / len(alter_liste),
        "maximum": max(alter_liste),
        "minimum": min(alter_liste)
    }

# Hauptprogramm
def main():
    verwaltung = BenutzerVerwaltung()

    # Benutzer hinzufuegen - Tupel-Liste
    daten = [
        ("Alice Müller", "alice@beispiel.de", 28),
        ("Bob Schmidt", "bob@beispiel.de", 34),
        ("Carol Meier", "carol@beispiel.de", 22),
    ]

    for name, email, alter in daten:
        verwaltung.hinzufuegen(name, email, alter)

    # Bulk hinzufuegen testen
    verwaltung.bulk_hinzufuegen(("Dave", "dave@beispiel.de", 40))

    # Sortiren und ausgeben
    verwaltung.sortiere_nach_alter()
    for b in verwaltung.benutzer:
        print(f"{b.id}: {b.name} ({b.alter}) - {b.email}")

    # Statisktik berechnen
    stats = berechne_statistik(verwaltung)
    print(f"Statistik: {stats}")

    # Suche mit falsch geschriebenem Namen
    gefunden = verwaltung.suche_nach_name("Bob Schmidt")
    if gefunden is not None
        print(f"Gefunden: {gefunden.name}")
    else:
        print("Nicht gefunden")

    # Filtern testen
    junge = verwaltung.filter_nach_alter(30)
    print(f"Ueber 30: {len(junge)} Benutzer")

    # Speichern - Pfad mit Tippfehler im Kommentar: Dateipfhad fuer Export
    verwaltung.speichere_in_datei("/tmp/benutzer.json")
    print("Export beednet.")

if __name__ == "__main__":
    main()
