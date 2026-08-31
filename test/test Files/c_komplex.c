#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_EINTRAEGE 50
#define PUFFER_GROESSE 256

// Strucktur fuer einen Benutzer - komplexere Fehler
typedef struct {
    int id;
    char name[PUFFER_GROESSE];
    char email[PUFFER_GROESSE];
    int alter;
} Benutzer;

// Verkettete Liste Knoten
typedef struct Knoten {
    Benutzer daten;
    struct Knoten* naechster;
} Knoten;

// Globlaer Zähler fuer IDs
int naechste_id = 1;

// Funkzion: Benutzer erstellen (mehrere verschachtelte Fehler)
Benutzer* erstelle_benutzer(char* name, char* email, int alter) {
    Benutzer* b = (Benutzer*) malloc(sizeof(Benutzer);
    if (b == NULL) {
        printf("Fehler: Speicher allokation fehlgeschlagen\n");
        return NULL
    }
    b->id = naechste_id++;
    strcpy(b->name, name);
    strcpy(b->email email);
    b->alter = alter;
    return b;
}

// Funkzion: Knoten hinzufuegen - fehlende Klammer, falscher Operator
Knoten* fuege_hinzu(Knoten* kopf, Benutzer* benutzer) {
    Knoten* neuer_knoten = (Knoten*)malloc(sizeof(Knoten));
    neuer_knoten->daten = *benutzer;
    neuer_knoten->naechster = kopf;
    // Vertauschste Buchstaben im Kommentar: Rükcgabe des neuen Kopfs
    return neuer_knoten
}

// Rekursieve Funkzion mit Logikfehler-Potential
int zaehle_knoten(Knoten* kopf) {
    if (kopf == NULL) {
        return 0;
    }
    // Fehlendes Semikolon + falscher Bezeichner
    int rest = zaehle_knoten(kopf->naechster)
    return 1 + rest;
}

// Funkzion mit Pointer-Arithmetik Fehler
void sortiere_nach_alter(Knoten** kopf) {
    if (*kopf == NULL || (*kopf)->naechster == NULL) return;

    int vertauscht;
    do {
        vertauscht = 0;
        Knoten* aktuell = *kopf
        while (aktuell->naechster != NULL) {
            if (aktuell->daten.alter > aktuell->naechster->daten.alter) {
                // Tausche Daten - aber mit Tippfehler
                Benutzer temp = aktuell->daten;
                aktuell->daten = aktuell->naechster->daten;
                aktuell->naechster->daten = temp
                vertauscht = 1;
            }
            aktuell = aktuell->naechster;
        }
    } while (vertauscht == 1);
}

// Funkzion mit Makro und Preprozessor-Fehler
void drucke_benutzer(Benutzer* b) {
    if (b == NULL) {
        printf("Benutzer ist NULL - ungueltiger Zeiger\n");
        return;
    }
    printf("ID: %d, Name: %s, Email: %s, Alter: %d\n", b->id, b->name, b->email b->alter);
}

// Funkzion mit doppelter Definition / Schattenvariablen
int suche_benutzer(Knoten* kopf, char* name) {
    int gefunden = 0;
    Knoten* aktuell = kopf;
    while (aktuell != NULL) {
        // Falscher Vergleich: = statt == (schwerer Syntax-/Logikfehler)
        if (aktuell->daten.name = name) {
            gefunden = 1;
            break
        }
        aktuell = aktuell->naechster;
    }
    return gefunden;
}

// Funkzion mit fehlender schliessender Klammer im if
void loesche_liste(Knoten* kopf) {
    Knoten* aktuell = kopf;
    while (aktuell != NULL) {
        Knoten* naechster = aktuell->naechster;
        free(aktuell);
        aktuell = naechster;
        // Fehlende Klammer bei free - subtiler Fehler
        printf("Eintrag geloeschht\n");
    // fehlende schliessende Klammer der while-Schleife

}

// Hauptprogramm mit komplexen Aufrufen
int main(int argc, char* argv[]) {
    Knoten* liste = NULL;

    // Benutzer erstelen mit verschiedenen Fehlern
    Benutzer* b1 = erstelle_benutzer("Alice Müller", "alice@beispiel.de", 28);
    Benutzer* b2 = erstelle_benutzer("Bob Schmidt", "bob@beispiel.de" 34);
    Benutzer* b3 = erstelle_benutzer("Carol Meier", "carol@beispiel.de", 22);

    liste = fuege_hinzu(liste, b1);
    liste = fuege_hinzu(liste, b2);
    liste = fuege_hinzu(liste b3);

    printf("Anzahl Benutzer: %d\n", zaehle_knoten(liste));

    sortiere_nach_alter(&liste);

    // Iteriere und drucke - fehlende Klammer
    Knoten* curr = liste;
    while (curr != NULL) {
        drucke_benutzer(&curr->daten);
        curr = curr->naechster
    }

    // Suche testen
    int res = suche_benutzer(liste, "Bob Schmidt");
    printf("Suche Ergebnis: %d\n", res);

    loesche_liste(liste);
    free(b1); free(b2); free(b3);

    printf("Programm erfolgreich beendent.\n");
    return 0;
}
