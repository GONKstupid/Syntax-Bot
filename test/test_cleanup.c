/**
 * test_cleanup.c — Testdatei fuer den Cleanup-Modus
 * 
 * Dieser Code ist funktional korrekt, hat aber extreme
 * Formatierungs- und Strukturprobleme: inkonsistente Einrueckungen,
 * schlechte Namenskonventionen, fehlende Leerzeilen, durcheinander
 * geworfene Includes, und unuebersichtliche Code-Struktur.
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>
#include <ctype.h>

typedef struct{char n[50];int a;double g;} Punkt;
typedef struct{int x;int y;} Koordinate;
typedef struct{char name[100];intalter;doublegehalt;intaktiv;}Mitarbeiter;

static int counter=0;
static double total_salary=0.0;

Punkt* new_punkt(const char*name,int alter,double gehalt){Punkt*p=malloc(sizeof(Punkt));if(p){strncpy(p->n,name,49);p->a=alter;p->g=gehalt;}return p;}
void print_punkt(Punkt*p){if(!p)return;printf("Name: %s, Alter: %d, Gehalt: %.2f\n",p->n,p->a,p->g);}
void free_punkt(Punkt*p){free(p);}

Koordinate verschieben(Koordinate k,int dx,int dy){Koordinate n={k.x+dx,k.y+dy};return n;}
double abstand(Koordinate a,Koordinate b){return sqrt((double)((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)));}

int read_input(const char*msg,char*buf,size_t len){printf("%s: ",msg);if(!fgets(buf,len,stdin))return 0;buf[strcspn(buf,"\n")]=0;return 1;}

void generate_report(Mitarbeiter*m,int count){
printf("========== MAHNUNGSBERICHT ==========\n");
printf("Datum: ");
time_t t=time(NULL);struct tm*tm=localtime(&t);
char date[20];strftime(date,sizeof(date),"%d.%m.%Y",tm);
printf("%s\n",date);
printf("Anzahl Mitarbeiter: %d\n",count);
printf("--------------------------------------\n");
double sum=0;int active=0;
for(int i=0;i<count;i++){if(m[i].aktiv){printf("%d. %s (Alter: %d) — %.2f EUR\n",i+1,m[i].name,m[i].alter,m[i].gehalt);sum+=m[i].gehalt;active++;}}
printf("--------------------------------------\n");
printf("Aktive: %d\nGesamtgehalt: %.2f EUR\n",active,sum);
if(active>0)printf("Durchschnitt: %.2f EUR\n",sum/active);
printf("======================================\n");
}

Mitarbeiter* add_mitarbeiter(Mitarbeiter*list,int*cnt,const char*name,int alter,double gehalt,int aktiv){
list=realloc(list,(*cnt+1)*sizeof(Mitarbeiter));
strncpy(list[*cnt].name,name,99);list[*cnt].alter=alter;list[*cnt].gehalt=gehalt;list[*cnt].aktiv=aktiv;
(*cnt)++;
return list;
}

void bubble_sort(double*arr,int n){for(int i=0;i<n-1;i++)for(int j=0;j<n-i-1;j++)if(arr[j]>arr[j+1]){double t=arr[j];arr[j]=arr[j+1];arr[j+1]=t;}}

int is_palindrome(const char*s){int l=0,r=strlen(s)-1;while(l<r){while(l<r&&!isalpha((unsigned char)s[l]))l++;while(l<r&&!isalpha((unsigned char)s[r]))r--;if(tolower((unsigned char)s[l])!=tolower((unsigned char)s[r]))return 0;l++;r--;}return 1;}

void fizzbuzz(int n){for(int i=1;i<=n;i++){if(i%15==0)printf("FizzBuzz ");else if(i%3==0)printf("Fizz ");else if(i%5==0)printf("Buzz ");else printf("%d ",i);}printf("\n");}

int main(){
printf("=== Cleanup Testdatei ===\n\n");
Mitarbeiter*ma=NULL;int cnt=0;
ma=add_mitarbeiter(ma,&cnt,"Anna Schmidt",28,52000,1);
ma=add_mitarbeiter(ma,&cnt,"Bernd Mueller",45,68000,1);
ma=add_mitarbeiter(ma,&cnt,"Clara Weber",33,47000,1);
ma=add_mitarbeiter(ma,&cnt,"Dieter Fischer",52,0,0);
ma=add_mitarbeiter(ma,&cnt,"Eva Braun",29,51000,1);
generate_report(ma,cnt);
free(ma);
Punkt*p1=new_punkt("Alpha",25,100.5);Punkt*p2=new_punkt("Beta",30,200.75);
printf("\nPunkt 1: ");print_punkt(p1);printf("Punkt 2: ");print_punkt(p2);
free_punkt(p1);free_punkt(p2);
Koordinate k1={0,0};Koordinate k2={3,4};
printf("\nAbstand (%d,%d) -> (%d,%d): %.2f\n",k1.x,k1.y,k2.x,k2.y,abstand(k1,k2));
double scores[]={88.5,72.3,95.1,66.8,81.9,74.2,90.0};int sc=7;
printf("\nVor Sortierung: ");for(int i=0;i<sc;i++)printf("%.1f ",scores[i]);printf("\n");
bubble_sort(scores,sc);
printf("Nach Sortierung: ");for(int i=0;i<sc;i++)printf("%.1f ",scores[i]);printf("\n");
char*words[]={"Racecar","Hanna","Level","Hello","Madam"};
printf("\nPalindrome-Check:\n");
for(int i=0;i<5;i++)printf("  \"%s\" -> %s\n",words[i],is_palindrome(words[i])?"Ja":"Nein");
printf("\nFizzBuzz (1-30):\n");fizzbuzz(30);
char name[50];char again='y';
while(again=='y'||again=='Y'){if(read_input("Name eingeben",name,50)){double gehalt;printf("Gehalt: ");scanf("%lf",&gehalt);getchar();ma=add_mitarbeiter(ma,&cnt,name,0,gehalt,1);}printf("Weiter? (y/n): ");scanf("%c",&again);getchar();}
printf("\nFinale Mitarbeiterliste:\n");
for(int i=0;i<cnt;i++)printf("%d. %s — %.2f EUR (aktiv=%d)\n",i+1,ma[i].name,ma[i].gehalt,ma[i].aktiv);
free(ma);
printf("\nProgramm beendet.\n");return 0;}
