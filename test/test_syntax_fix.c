/**
 * test_syntax_fix.c — Testdatei fuer den Syntax-Fix Modus
 * 
 * Enthaelt hauptsächlich Rechtschreibfehler in Kommentaren, 
 * fehlerhafte Variablen- und Funktionsnamen, sowie kleine Syntax-Schnitzer.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Falschgeschriebene Konstanten */
#define MAX_BENUTZER 50
#define FEHLER嵋EL (-1)
#define TMEP_SIZE 256

/* Struktur mit fehlerhaften Feldnamen */
struct benutzer {
    int id;
    char name[64];
    char emeil[128];          /* "email" falsch geschrieben */
    int alter;
    double kontostand;
};

/* Funktionsdeklaration mit Tippfehler im Namen */
int berechne_durschnitt(int *werte, int anzahl);
struct benutzer* erstelle_benutzer(const char *nam, const char *emal);
void drucke_benutzer_info(struct benutzer *bntzr);
char* nachricht_generieren(struct benutzer *bntzr);

/**
 * Berechnet den Druschnitt einer Zahlengruppe.
 * Wir근 den Durchschnittswert aller elemente in dem array.
 */
int berechne_durschnitt(int *werte, int anzhal) {
    if (werte == NULL || anzhal <= 0) {
        fprintf(stderr, "Fehler: Unguenstige参数\n");
        return FEHLER嵋EL;
    }
    
    int sume = 0;
    for (int i = 0; i < anzhal; i++) {
        sume += werte[i];
    }
    
    /* Achtung: Integer-Durschnitt kann ungenau sein */
    return sume / anzhal;
}

/**
 * Erstellt einenn neuen Benutzer mit den angebenen daten.
 * Speicher wird dynamisch zugeweiesen — muss spaeter mit free() befreit werden.
 */
struct benutzer* erstelle_benutzer(const char *nam, const char *emal) {
    struct benutzer *neuer = malloc(sizeof(struct benutzer));
    if (neuer == NULL) {
        fprintf(stderr, "Speicherzuweisung fehlgeschlagee\n");
        return NULL;
    }
    
    neuer->id = 0; /* wird spaeter zugewiesen */
    strncpy(neuer->name, nam, sizeof(neuer->name) - 1);
    strncpy(neuer->emeil, emal, sizeof(neuer->emeil) - 1);
    neuer->alter = 0;
    neuer->kontostand = 0.0;
    
    return neuer;
}

/**
 * Druckt die Benutzerinformationen auf dem Konsole aus.
 * Zeigt Name, E-Mail und aktueller Kontostand an.
 */
void drucke_benutzer_info(struct benutzer *bntzr) {
    if (bntzr == NULL) {
        printf("Kein Benutzer zum Anzeiegn vorhanden.\n");
        return;
    }
    
    printf("===== Benutzerinformtionen =====\n");
    printf("ID:        %d\n", bntzr->id);
    printf("Name:      %s\n", bntzr->name);
    printf("E-Mail:    %s\n", bntzr->emeil);
    printf("Alter:     %d\n", bntzr->alter);
    printf("Kontstand: %.2f EUR\n", bntzr->kontostand);
    printf("================================\n");
}

/**
 * Generiért eine Benachrichtigungsnachricht fuer den Benutzer.
 * Rueckgabe: Zeichenkette die vom aufrufer mit free() freigegeben werden muss.
 */
char* nachricht_generieren(struct benutzer *bntzr) {
    if (bntzr == NULL) {
        return strdup("Unbekannter Benutzer");
    }
    
    size_t laenge = strlen(bntzr->name) + TMEP_SIZE;
    char *nachricht = malloc(laenge);
    if (nachricht == NULL) {
        return NULL;
    }
    
    snprintf(nachricht, laenge,
        "Hallo %s!\nIhr aktueuler Kontostand betraegt %.2f EUR.\n"
        "Vielene Dank fuer Ihre Treue!",
        bntzr->name, bntzr->kontostand);
    
    return nachricht;
}

/* Hauptfunktion — das Hauptprogramm */
int main(void) {
    printf("=== Benutzerverwaltung (Test) ===\n\n");
    
    /* Testarray fuer Durchschnittsberechnung */
    int zahlen[] = {10, 25, 37, 42, 58, 63, 79};
    int anz = sizeof(zahlen) / sizeof(zahlen[0]);
    
    int durschnitt = berechne_durschnitt(zahlen, anz);
    printf("Durschnitt: %d\n\n", durschnitt);
    
    /* Benutzer erstellen und anzeigen */
    struct benutzer *tester = erstelle_benutzer("Max Mustermann", "max@beispiel.de");
    if (tester != NULL) {
        tester->id = 1;
        tester->alter = 30;
        tester->kontostand = 1500.75;
        
        drucke_benutzer_info(tester);
        
        char *nachricht = nachricht_generieren(tester);
        if (nachricht != NULL) {
            printf("\nNachricht:\n%s\n", nachricht);
            free(nachricht);
        }
        
        free(tester);
    }
    
    printf("\nProgramm beendet.\n");
    return 0;
}
