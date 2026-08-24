/**
 * test_code_fix.c — Testdatei fuer den Code-Fix Modus
 * 
 * Enthaelt strukturelle Fehler, Bugs, Sicherheitsluecken und
 * problematisches Verhalten, das ueber reine Rechtschreibfehler hinausgeht.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_DATA_LEN 1024
#define MAX_EINTRAEGE 100

/* Struktur fuer einen einfachen Stack */
typedef struct {
    int *daten;
    int kapazitaet;
    int anzahl;
} Stack;

/* Struktur fuer einen Benutzereintrag */
typedef struct {
    int id;
    char name[64];
    char email[128];
    int aktiv;
} Benutzer;

/* Globale Variable — schlechte Praxis aber hier fuer Testzwecke */
static Benutzer g_benutzer[MAX_EINTRAEGE];
static int g_anzahl_benutzer = 0;

/* ======================== Stack-Funktionen ======================== */

Stack* stack_erstellen(int kapazitaet) {
    Stack *s = malloc(sizeof(Stack));
    /* BUG: Keine Prüfung ob malloc erfolgreich war */
    s->kapazitaet = kapazitaet;
    s->daten = malloc(sizeof(int) * kapazitaet);
    s->anzahl = 0;
    return s;
}

void stack_schieben(Stack *s, int wert) {
    /* BUG: Keine Prüfung ob Stack voll oder s == NULL */
    s->daten[s->anzahl] = wert;
    s->anzahl++;
}

int stack_pop(Stack *s) {
    /* BUG: Keine Prüfung ob Stack leer — Underflow moeglich */
    s->anzahl--;
    return s->daten[s->anzahl];
}

int stack_peek(Stack *s) {
    /* BUG: Gibt Index -1 zurueck wenn leer, aber s->anzahl-1 ist unterlaeufig */
    return s->daten[s->anzahl - 1];
}

void stack_freigeben(Stack *s) {
    /* BUG: Freiebt daten, aber nicht die Stack-Struktur selbst (Memory Leak) */
    free(s->daten);
}

/* ======================== Benutzerverwaltung ======================== */

/**
 * Fuegt einen neuen Benutzer hinzu.
 * Gibt den Index zurueck oder -1 bei Fehler.
 */
int benutzer_hinzufuegen(const char *name, const char *email, int aktiv) {
    if (g_anzahl_benutzer >= MAX_EINTRAEGE) {
        return -1;
    }
    
    Benutzer *b = &g_benutzer[g_anzahl_benutzer];
    b->id = g_anzahl_benutzer;
    
    /* BUG: strcpy ohne Laengenpruefung — Buffer Overflow moeglich */
    strcpy(b->name, name);
    strcpy(b->email, email);
    b->aktiv = aktiv;
    
    g_anzahl_benutzer++;
    return b->id;
}

/**
 * Sucht einen Benutzer per Name.
 * BUG: Gibt Pointer auf statisches Array zurueck — nicht thread-safe,
 *      und der Zeiger wird ungueltig beim naechsten Aufruf.
 */
Benutzer* benutzer_suchen(const char *name) {
    for (int i = 0; i < g_anzahl_benutzer; i++) {
        if (strcmp(g_benutzer[i].name, name) == 0) {
            return &g_benutzer[i];
        }
    }
    return NULL;
}

/**
 * Loescht einen Benutzer per Index.
 * BUG: Verschiebt nachfolgende Eintraege, aber vergisst den letzten —
 *      enthält dann noch den alten Eintrag (Datenleck).
 */
void benutzer_loeschen(int id) {
    if (id < 0 || id >= g_anzahl_benutzer) return;
    
    for (int i = id; i < g_anzahl_benutzer - 1; i++) {
        g_benutzer[i] = g_benutzer[i + 1];
    }
    /* BUG: Der letzte Eintrag wird nicht gelscht */
    g_anzahl_benutzer--;
}

/* ======================== Datei-Operationen ======================== */

/**
 * Liest eine Datei komplett in einen Puffer.
 * BUG: Keine Pruefung der tatsaechlichen read-bytes gegen buffer_groesse.
 *      fgets kann unvollstaendige Zeilen zurueckgeben.
 */
char* datei_leser(const char *pfad) {
    FILE *fp = fopen(pfad, "r");
    if (fp == NULL) {
        return NULL;
    }
    
    /* BUG: Statischer Puffer — keine Skalierbarkeit, kein Null-Terminator-Schutz */
    static char puffer[MAX_DATA_LEN];
    char zeile[256];
    
    puffer[0] = '\0';
    while (fgets(zeile, sizeof(zeile), fp) != NULL) {
        /* BUG: Keine Pruefung ob puffer noch gross genug ist */
        strcat(puffer, zeile);
    }
    
    fclose(fp);
    return puffer; /* BUG: Gibt statischen Puffer zurueck — nicht thread-safe */
}

/**
 * Schreibt Daten in eine Datei.
 * BUG: Oeffnet die Datei nicht im Anhaenge-Modus,ueberschreibt also immer.
 *      Kein flush/fflush am Ende.
 */
int datei_schreiber(const char *pfad, const char *daten) {
    FILE *fp = fopen(pfad, "w");
    if (fp == NULL) {
        return -1;
    }
    
    size_t len = strlen(daten);
    fwrite(daten, 1, len, fp);
    /* BUG: fclose wird manchmal vergessen wenn vorher ein Fehler auftritt */
    fclose(fp);
    return 0;
}

/* ======================== String-Helfer ======================== */

/**
 * Kopiert einen String — eigene Implementierung.
 * BUG: Wenn quell Laenge == ziel Laenge ist, wird kein Null-Terminator geschrieben.
 */
char* string_kopieren(const char *quelle, char *ziel, size_t ziel_groesse) {
    if (quelle == NULL || ziel == NULL) return NULL;
    
    size_t i;
    for (i = 0; i < ziel_groesse - 1 && quelle[i] != '\0'; i++) {
        ziel[i] = quelle[i];
    }
    /* BUG: Wenn i == ziel_groesse - 1 und der Quellstring laenger ist,
       fehlt der Null-Terminator */
    ziel[i] = '\0';
    return ziel;
}

/**
 * Findet das erste Vorkommen eines Zeichens in einem String.
 * BUG: Gibt 1-basierten Index zurueck statt 0-basiert — inkonsistent mit C.
 */
int zeichen_finden(const char *str, char zeichen) {
    if (str == NULL) return -1;
    
    for (int i = 0; str[i] != '\0'; i++) {
        if (str[i] == zeichen) {
            return i + 1; /* BUG: Sollte i sein, nicht i+1 */
        }
    }
    return 0; /* BUG: 0 als "nicht gefunden" ist irrefuehrend — 0 ist gueltiger Index */
}

/* ======================== Hauptprogramm ======================== */

int main(int argc, char *argv[]) {
    printf("=== Code-Fix Testdatei ===\n\n");
    
    /* Stack-Test */
    Stack *mein_stack = stack_erstellen(10);
    stack_schieben(mein_stack, 42);
    stack_schieben(mein_stack, 99);
    stack_schieben(mein_stack, 7);
    
    printf("Top of Stack: %d\n", stack_peek(mein_stack));
    printf("Pop: %d\n", stack_pop(mein_stack));
    printf("Pop: %d\n", stack_pop(mein_stack));
    
    stack_freigeben(mein_stack);
    free(mein_stack); /* Korrekt — aber stack_freigeben vergisst das */
    
    /* Benutzer-Test */
    benutzer_hinzufuegen("Alice", "alice@test.de", 1);
    benutzer_hinzufuegen("Bob", "bob@test.de", 1);
    benutzer_hinzufuegen("Charlie", "charlie@test.de", 0);
    
    Benutzer *gefunden = benutzer_suchen("Bob");
    if (gefunden != NULL) {
        printf("Gefunden: %s (aktiv=%d)\n", gefunden->name, gefunden->aktiv);
    }
    
    benutzer_loeschen(1); /* Bob loeschen */
    printf("Anzahl Benutzer nach Loeschung: %d\n", g_anzahl_benutzer);
    /* BUG: Letzter Eintrag (Charlie) ist noch im Array obwohl nicht sichtbar */
    
    /* String-Test */
    char ziel[10];
    string_kopieren("Hallo Welt!", ziel, sizeof(ziel));
    printf("Kopiert: \"%s\"\n", ziel);
    
    int pos = zeichen_finden("Hallo", 'l');
    printf("Zeichen 'l' gefunden an Position: %d\n", pos);
    /* Erwartet 3 (null-indiziert), gibt aber 4 zurueck */
    
    printf("\nProgramm beendet.\n");
    return 0;
}
