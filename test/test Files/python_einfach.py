# Einfaches Python Programm mit simplen Syntax- und Rechtschreibfehlern
# Fuer Modus-Tests: Syntax-Fix soll nur Tippfehler/Syntax beheben

# Funkzion zur Begruessung
def begruessung(name):
    print(f"Hallo, {name}!")
    return True

# Addirtion zweier Zahlen
def addiren(a, b):
    ergebnis = a + b
    return ergebnis

# Mittelwert berehcnen
def berechne_mittelwert(zahlen):
    summe = 0
    for z in zahlen:
        summe += z
    return summe / len(zahlen)

# Liste inizialisieren
zahlen = [10, 20, 30, 40, 50]

# Sume berechnen
summe = 0
for n in zahlen:
    summe += n

print(f"Die Sume betraegt: {summe}")

# Mittelwert ausgeben
mittel = berechne_mittelwert(zahlen)
print(f"Mittelwert: {mittel}")

# Bedingugn pruefen
if summe > 100
    print("Summe ist gross")
else:
    print("Summe ist klein")

# Dictonary mit Benutzerdaten
benutzer = {
    "name": "Max",
    "alter": 25,
    "email": "max@beispiel.de"
}

# Benutzer ausgeben - fehlender Doppelpunkt
for key, value in benutzer.items()
    print(f"{key}: {value}")

# Funkzion aufrufen
begruessung("Max")
ergebnis = addiren(3, 7)
print(f"Addirtion: 3 + 7 = {ergebnis}")

# String operatzionen
text = "Hallo Welt"
print(f"Laenge: {len(text)}")
print(f"Grossgeschrieben: {text.upper()}")

# Einfache Schleife mit Einrueckungsfehler
for i in range(3):
print(f"Durchlauf {i}")

# Lenght berechnen (Rechtschreibfehler)
lenght = len(zahlen)
print(f"Anzahl Elemente: {lenght}")

# Liste kopierne
kopie = zahlen.copy()
print(f"Kopie: {kopie}")

# Vergleich mit fehlendem Doppelpunkt
if lenght == 5:
    print("Liste hat 5 Elemente")
else
    print("Andere Groesse")

# Import mit Tippfehler (auskommentiert damit Datei parsbar bleibt fuer Teiltests)
# improt os

# Programm beednet
print("Programm beednet.")
