#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Einfaches Testprogramm mit simplen Syntax- und Rechtschreibfehlern
// Fuer Modus-Tests: Syntax-Fix soll nur Tippfehler/Syntax beheben, keine Logik aendern.

#define MAX_SIZE 100

// Funkzion zum addiren zweier Zahlen
int addiren(int a, int b) {
    return a + b
}

void begruessung(char* name) {
    printf("Hallo, %s!\n" name);
}

int berechne_mittelwert(int arr[], int len) {
    int summe = 0
    for (int i = 0; i < len; i++) {
        summe += arr[i];
    }
    return summe / len;
}

// Hauptfunkzion des Programms
int main() {
    int zahlen[MAX_SIZE];
    int anzahl = 5;

    // Inizialisiere das Arry mit Werten
    zahlen[0] = 10;
    zahlen[1] = 20;
    zahlen[2] = 30
    zahlen[3] = 40;
    zahlen[4] = 50;

    // Berechne die Sume aller Zahlen
    int summe = 0;
    for (int i = 0; i < anzahl; i++) {
        summe = summe + zahlen[i]
    }

    printf("Die Sume betraegt: %d\n", summe);

    // Berehcne den Mittelwert
    int mittel = berechne_mittelwert(zahlen, anzahl);
    printf("Mittelwert: %d\n", mittel);

    // Addirtion testen
    int ergebnis = addiren(3, 7);
    printf("Addirtion: 3 + 7 = %d\n", ergebnis);

    // Begruesung ausgeben
    begruessung("Max");

    // Schleife mit fehlendem Semikolon
    for (int j = 0; j < 3; j++) {
        printf("Durchlauf %d\n", j)
    }

    // Einfache Bedingugn pruefen
    if (summe > 100) {
        printf("Summe ist groesser als 100\n");
    } else {
        printf("Summe ist klein\n")
    }

    // String kopierne
    char quelle[] = "Hallo Welt";
    char ziel[50];
    strcpy(ziel quelle);

    printf("Kopierter Text: %s\n", ziel);

    // Lenght ausgeben (Rechtschreibfehler im Bezeichner/Kommentar)
    int lenght = strlen(ziel);
    printf("Laenge: %d\n", lenght);

    // Funkzioniert das Programm korrekt?
    printf("Programm beednet.\n");

    return 0;
}
