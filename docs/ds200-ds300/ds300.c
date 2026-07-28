/****************************************************************************
*
*  $Workfile:   ds300.c  $
*  Original Author: George Warner, warnergt@ptd.net
*  Based on: bgterm.c -- win32 console app to talk to comm1 by Bob G, bobgardner@aol.com
*  $Revision:   1.1  $
*  $Date:   21 Feb 2006 12:00:00  $
 * 
 *    Rev 1.1   21 Feb 2006 12:00:00   warnergt
 * Added ability to select comm port at start of program.
 * 
 *    Rev 1.0   25 Dec 2005 12:00:00   warnergt
 * initial version
 *
*  General Description: Console program to receive communications from DS300.
****************************************************************************/

#include <windows.h>
#include <stdio.h>
#include <conio.h>

/**********************************************************************/
/* Prototypes                                                         */
/**********************************************************************/
void initvars(void);
int initcom(char *port_name);
int closecom(void);
int auxchk1(void);
char auxin1(void);
void auxout1(char c);
void auxstr(char *s);
void gotoxy(int x, int y);
void auxgotoxy(int x, int y);
void auxclrscr(void);
void term(void);
void mainmenu(void);
void commmenu(void);
void ds300(void);
int mygetc(void);

#define TITLE "DS300 Console Application"
#define REVISION "21 Feb 2006"

//--ascii chars---
#define ESC 0x1b
#define CR  0x0d

#if 0  //stuff cut from winbase.h
//
// Comm provider settable parameters.
#define SP_PARITY         ((DWORD)0x0001)
#define SP_BAUD           ((DWORD)0x0002)
#define SP_DATABITS       ((DWORD)0x0004)
#define SP_STOPBITS       ((DWORD)0x0008)
#define SP_HANDSHAKING    ((DWORD)0x0010)
#define SP_PARITY_CHECK   ((DWORD)0x0020)
#define SP_RLSD           ((DWORD)0x0040)

//
// Settable baud rates in the provider.
#define BAUD_075          ((DWORD)0x00000001)
#define BAUD_110          ((DWORD)0x00000002)
#define BAUD_134_5        ((DWORD)0x00000004)
#define BAUD_150          ((DWORD)0x00000008)
#define BAUD_300          ((DWORD)0x00000010)
#define BAUD_600          ((DWORD)0x00000020)
#define BAUD_1200         ((DWORD)0x00000040)
#define BAUD_1800         ((DWORD)0x00000080)
#define BAUD_2400         ((DWORD)0x00000100)
#define BAUD_4800         ((DWORD)0x00000200)
#define BAUD_7200         ((DWORD)0x00000400)
#define BAUD_9600         ((DWORD)0x00000800)
#define BAUD_14400        ((DWORD)0x00001000)
#define BAUD_19200        ((DWORD)0x00002000)
#define BAUD_38400        ((DWORD)0x00004000)
#define BAUD_56K          ((DWORD)0x00008000)
#define BAUD_128K         ((DWORD)0x00010000)
#define BAUD_115200       ((DWORD)0x00020000)
#define BAUD_57600        ((DWORD)0x00040000)
#define BAUD_USER         ((DWORD)0x10000000)

//
// Settable Data Bits
#define DATABITS_5        ((WORD)0x0001)
#define DATABITS_6        ((WORD)0x0002)
#define DATABITS_7        ((WORD)0x0004)
#define DATABITS_8        ((WORD)0x0008)
#define DATABITS_16       ((WORD)0x0010)
#define DATABITS_16X      ((WORD)0x0020)

//
// Settable Stop and Parity bits.
#define STOPBITS_10       ((WORD)0x0001)
#define STOPBITS_15       ((WORD)0x0002)
#define STOPBITS_20       ((WORD)0x0004)
#define PARITY_NONE       ((WORD)0x0100)
#define PARITY_ODD        ((WORD)0x0200)
#define PARITY_EVEN       ((WORD)0x0400)
#define PARITY_MARK       ((WORD)0x0800)
#define PARITY_SPACE      ((WORD)0x1000)

typedef struct _COMMPROP {
    WORD wPacketLength;
    WORD wPacketVersion;
    DWORD dwServiceMask;
    DWORD dwReserved1;
    DWORD dwMaxTxQueue;
    DWORD dwMaxRxQueue;
    DWORD dwMaxBaud;
    DWORD dwProvSubType;
    DWORD dwProvCapabilities;
    DWORD dwSettableParams;
    DWORD dwSettableBaud;
    WORD wSettableData;
    WORD wSettableStopParity;
    DWORD dwCurrentTxQueue;
    DWORD dwCurrentRxQueue;
    DWORD dwProvSpec1;
    DWORD dwProvSpec2;
    WCHAR wcProvChar[1];
} COMMPROP,*LPCOMMPROP;

//
// Set dwProvSpec1 to COMMPROP_INITIALIZED to indicate that wPacketLength
// is valid before a call to GetCommProperties().
#define COMMPROP_INITIALIZED ((DWORD)0xE73CF52E)

typedef struct _COMSTAT {
    DWORD fCtsHold : 1;
    DWORD fDsrHold : 1;
    DWORD fRlsdHold : 1;
    DWORD fXoffHold : 1;
    DWORD fXoffSent : 1;
    DWORD fEof : 1;
    DWORD fTxim : 1;
    DWORD fReserved : 25;
    DWORD cbInQue;
    DWORD cbOutQue;
} COMSTAT, *LPCOMSTAT;

//
// DTR Control Flow Values.
#define DTR_CONTROL_DISABLE    0x00
#define DTR_CONTROL_ENABLE     0x01
#define DTR_CONTROL_HANDSHAKE  0x02

//
// RTS Control Flow Values
#define RTS_CONTROL_DISABLE    0x00
#define RTS_CONTROL_ENABLE     0x01
#define RTS_CONTROL_HANDSHAKE  0x02
#define RTS_CONTROL_TOGGLE     0x03

typedef struct _DCB {
    DWORD DCBlength;      /* sizeof(DCB)                     */
    DWORD BaudRate;       /* Baudrate at which running       */
    DWORD fBinary: 1;     /* Binary Mode (skip EOF check)    */
    DWORD fParity: 1;     /* Enable parity checking          */
    DWORD fOutxCtsFlow:1; /* CTS handshaking on output       */
    DWORD fOutxDsrFlow:1; /* DSR handshaking on output       */
    DWORD fDtrControl:2;  /* DTR Flow control                */
    DWORD fDsrSensitivity:1; /* DSR Sensitivity              */
    DWORD fTXContinueOnXoff: 1; /* Continue TX when Xoff sent */
    DWORD fOutX: 1;       /* Enable output X-ON/X-OFF        */
    DWORD fInX: 1;        /* Enable input X-ON/X-OFF         */
    DWORD fErrorChar: 1;  /* Enable Err Replacement          */
    DWORD fNull: 1;       /* Enable Null stripping           */
    DWORD fRtsControl:2;  /* Rts Flow control                */
    DWORD fAbortOnError:1; /* Abort all reads and writes on Error */
    DWORD fDummy2:17;     /* Reserved                        */
    WORD wReserved;       /* Not currently used              */
    WORD XonLim;          /* Transmit X-ON threshold         */
    WORD XoffLim;         /* Transmit X-OFF threshold        */
    BYTE ByteSize;        /* Number of bits/byte, 4-8        */
    BYTE Parity;          /* 0-4=None,Odd,Even,Mark,Space    */
    BYTE StopBits;        /* 0,1,2 = 1, 1.5, 2               */
    char XonChar;         /* Tx and Rx X-ON character        */
    char XoffChar;        /* Tx and Rx X-OFF character       */
    char ErrorChar;       /* Error replacement char          */
    char EofChar;         /* End of Input character          */
    char EvtChar;         /* Received Event character        */
    WORD wReserved1;      /* Fill for now.                   */
} DCB, *LPDCB;

typedef struct _COMMTIMEOUTS {
    DWORD ReadIntervalTimeout;          /* Maximum time between read chars. */
    DWORD ReadTotalTimeoutMultiplier;   /* Multiplier of characters.        */
    DWORD ReadTotalTimeoutConstant;     /* Constant in milliseconds.        */
    DWORD WriteTotalTimeoutMultiplier;  /* Multiplier of characters.        */
    DWORD WriteTotalTimeoutConstant;    /* Constant in milliseconds.        */
} COMMTIMEOUTS,*LPCOMMTIMEOUTS;

typedef struct _COMMCONFIG {
    DWORD dwSize;               /* Size of the entire struct */
    WORD wVersion;              /* version of the structure */
    WORD wReserved;             /* alignment */
    DCB dcb;                    /* device control block */
    DWORD dwProviderSubType;    /* ordinal value for identifying
                                   provider-defined data structure format*/
    DWORD dwProviderOffset;     /* Specifies the offset of provider specific
                                   data field in bytes from the start */
    DWORD dwProviderSize;       /* size of the provider-specific data field */
    WCHAR wcProviderData[1];    /* provider-specific data */
} COMMCONFIG,*LPCOMMCONFIG;

WINBASEAPI
HANDLE
WINAPI
CreateFileA(
    LPCSTR lpFileName,
    DWORD dwDesiredAccess,
    DWORD dwShareMode,
    LPSECURITY_ATTRIBUTES lpSecurityAttributes,
    DWORD dwCreationDisposition,
    DWORD dwFlagsAndAttributes,
    HANDLE hTemplateFile
    );

WINBASEAPI
BOOL
WINAPI
ReadFile(
    HANDLE hFile,
    LPVOID lpBuffer,
    DWORD nNumberOfBytesToRead,
    LPDWORD lpNumberOfBytesRead,
    LPOVERLAPPED lpOverlapped
    );

WINBASEAPI
BOOL
WINAPI
ClearCommError(
    HANDLE hFile,
    LPDWORD lpErrors,
    LPCOMSTAT lpStat
    );

WINBASEAPI
BOOL
WINAPI
GetCommConfig(
    HANDLE hCommDev,
    LPCOMMCONFIG lpCC,
    LPDWORD lpdwSize
    );

WINBASEAPI
BOOL
WINAPI
GetCommMask(
    HANDLE hFile,
    LPDWORD lpEvtMask
    );

WINBASEAPI
BOOL
WINAPI
GetCommProperties(
    HANDLE hFile,
    LPCOMMPROP lpCommProp
    );

WINBASEAPI
BOOL
WINAPI
GetCommModemStatus(
    HANDLE hFile,
    LPDWORD lpModemStat
    );

WINBASEAPI
BOOL
WINAPI
GetCommState(
    HANDLE hFile,
    LPDCB lpDCB
    );

WINBASEAPI
BOOL
WINAPI
GetCommTimeouts(
    HANDLE hFile,
    LPCOMMTIMEOUTS lpCommTimeouts
    );

WINBASEAPI
BOOL
WINAPI
PurgeComm(
    HANDLE hFile,
    DWORD dwFlags
    );

WINBASEAPI
BOOL
WINAPI
SetCommBreak(
    HANDLE hFile
    );

WINBASEAPI
BOOL
WINAPI
SetCommConfig(
    HANDLE hCommDev,
    LPCOMMCONFIG lpCC,
    DWORD dwSize
    );

WINBASEAPI
BOOL
WINAPI
SetCommMask(
    HANDLE hFile,
    DWORD dwEvtMask
    );

WINBASEAPI
BOOL
WINAPI
SetCommState(
    HANDLE hFile,
    LPDCB lpDCB
    );

WINBASEAPI
BOOL
WINAPI
SetCommTimeouts(
    HANDLE hFile,
    LPCOMMTIMEOUTS lpCommTimeouts
    );

WINBASEAPI
BOOL
WINAPI
TransmitCommChar(
    HANDLE hFile,
    char cChar
    );

WINBASEAPI
BOOL
WINAPI
WaitCommEvent(
    HANDLE hFile,
    LPDWORD lpEvtMask,
    LPOVERLAPPED lpOverlapped
    );
#endif

//----------globals------------
unsigned char c;
unsigned char buf;
unsigned char tmpstr[80];
DWORD numread,numwritten;
int echo;
int delay;
int newsg;
int curcomm;
int hexmode;
BOOL fsuccess;
DCB dcb;
HANDLE hcom = 0;
HANDLE hwnd;
COMSTAT comstat;
COMMPROP commprop;
COMMCONFIG cc;
OVERLAPPED overlapped;

//----------------------
void initvars(void){
//init some vars

    echo=0;
    hwnd=GetStdHandle(STD_OUTPUT_HANDLE);
    curcomm=0;
    hexmode=0;
}

//---------------------
int initcom(char *port_name){
//init comm port to 57600,n,8,1

    hcom=CreateFile(port_name,
        GENERIC_READ | GENERIC_WRITE,
        0,     //EXCLUSIVE ACCESS
        NULL, //no security attributes
        OPEN_EXISTING,
        0,    //NOT OVERLAPPED
        NULL);
    if(hcom==INVALID_HANDLE_VALUE) {
        printf("createfile failed %d\n",GetLastError());
        return(1);
    }
    fsuccess=GetCommState(hcom,&dcb);
    if(!fsuccess){
        printf("getcommstate failed %d\n",GetLastError());
        closecom();
        return(2);
    }
    dcb.BaudRate=CBR_57600;
    dcb.ByteSize=8;
    dcb.Parity=NOPARITY;
    dcb.StopBits=ONESTOPBIT;
    dcb.fDtrControl=DTR_CONTROL_DISABLE;
    dcb.fRtsControl=RTS_CONTROL_DISABLE;
    fsuccess=SetCommState(hcom,&dcb);
    if(!fsuccess){
        printf("setcommstate failed %d\n",GetLastError());
        closecom();
        return(3);
    }
    return(0);
}

//---------------------
int closecom(void){
//close comm port

    CloseHandle(hcom);
    return(0);
}

//---------------------
int auxchk1(void){
//return true if char waiting in comm port
unsigned long err;

    fsuccess=ClearCommError(hcom,&err,&comstat);
    if(!fsuccess){
        printf("auxchk failed %d\n",GetLastError());
//      return(1);
    }
    if(err) printf("auxchk err %d!\n",err);
    return (comstat.cbInQue !=0);
}

//---------------------
char auxin1(void){
//return c from comm port
char buf;

    fsuccess=ReadFile(hcom,&buf,1,&numread,0 /*&overlapped*/ );
    if(!fsuccess){
        printf("readfile failed %d\n",GetLastError());
        return(1);
    }
    return buf;
}

//---------------------
void auxout1(char c){
//write c to comm port
char buf;

    buf=c;
    fsuccess=WriteFile(hcom,&buf,1,&numwritten, 0 /*&overlapped*/ );
    if(!fsuccess){
        printf("writefile failed %d\n",GetLastError());
//      return(1);
    }
//  printf("\t%02x ",c); //debug
}

//---------------------
void auxstr(char *s){
//send s out aux
char c;

    while((c= *s++)!=0){
        auxout1(c);
    }
}

//-------------------
void gotoxy(int x, int y){
//position cursor on crt
COORD coord;

    coord.X=x;
    coord.Y=y;
//  SetConsoleCursorPostition(hwnd,coord);
}

//--------------------
void auxgotoxy(int x, int y){
//issue ansi cursor positioning sequence E[y;xH down rs232 to hc11 display
//6 bytes

  auxout1(ESC);
  auxout1('[');
    sprintf((char *)tmpstr,"%d",y);
//  printf("issued curpos row %d %s\n",y,tmpstr);
  auxstr((char *)tmpstr); 
  auxout1(';');
    sprintf((char *)tmpstr,"%d",x);
  auxstr((char *)tmpstr); 
  auxout1('H');
}

//----------------------
void auxclrscr(void){
//clear hc11 screen

  auxout1(ESC);
  auxout1('[');
  auxout1('2');
  auxout1('J');
}

//---------------------
void term(void){
//terminal mode  ctl-e to exit
char c;

    printf("\nTerminal mode. ctl-e to exit\n");
    while(1){
        if(auxchk1()){
            c=auxin1();
            if(hexmode){
                printf("%02x ",c&0xFF);
            }else{
                putchar(c);
            }
        }
        if (kbhit()) {
            c=getch();
            if(c==0x05)
                return;
            if(echo)
                putchar(c);
            auxout1(c);
            if(c==CR)
                putchar(0x0a); //send lf after cr
        }
    }
}

//---------------------
void ds300(void)
{
#define START_BYTE  0xE0
#define END_BYTE    0xEB
#define TOTAL_BYTES 21

int dataWord[TOTAL_BYTES] = {0};
int olddataWord[TOTAL_BYTES] = {0};
int byteCount, intc;
int sync = 0;
int i, checksum, olddata;

    printf("\nDS300 mode. Type any key to exit\n");
    while(1){
        if(auxchk1()){
            c=auxin1();
            intc = c & 0xFF;    /* This solves some leading FF problems with negative numbers. */
            /* If not in sync, check for synchronization to 21 byte data word. */
            if (!sync) 
            {
                if (intc == START_BYTE) 
                {
                    byteCount = 0;
                    dataWord[byteCount++] = intc;
                    sync = TRUE;
                }
                else 
                {
                    printf("c is %02x not %02x.\n", intc, START_BYTE);
                } 
            }
            else 
            {
                dataWord[byteCount++] = c;
                if (byteCount >= TOTAL_BYTES) 
                {
                    byteCount = 0;
                    /* See if dataWord is new.  DS300 has a habit of spitting out 
                       three identical dataWords in a row.  We don't need to look 
                       at it three times.                                           */
                    olddata = 1;
                    for (i=0; i<TOTAL_BYTES; i++) 
                    {
                        if (olddataWord[i] != dataWord[i]) 
                        {
                            olddata = 0;
                        }
                    }

                    /* If it is not old data, display it. */
                    if (!olddata)
                    {
                        /* Display results of data word. */
                        if (dataWord[3] == 2) 
                        {
                            printf("DS200: ");
                        }
                        else if (dataWord[3] == 3) 
                        {
                            printf("DS300: ");
                        }
                        /* Display type of data. */
                        switch (dataWord[7]) 
                        {
                            case 0x00:
                                printf("Function ");
                                break;
                            case 0x1B:
                                printf("Timing data ");
                                break;
                            case 0x1C:
                                printf("Final record data ");
                                break;
                            case 0x3A:
                                printf("Programmed by time ");
                                break;
                            case 0x3B:
                                printf("Programmed by laps (total) ");
                                break;
                            case 0x3C:
                                printf("Programmed by laps (individual) ");
                                break;
                            case 0x3D:
                                printf("Programmed by F1 ");
                                break;
                            default:
                                printf("Unknown data %02x ", dataWord[7]);
                                break;
                        }

                        printf("\n");

                        /* Display type of function (assuming we have a function). */
                        if (dataWord[7] == 0x00) 
                        {
                            switch (dataWord[8]) 
                            {
                                case 0xA1:
                                    printf("Start of race, phase 1 ");
                                    break;
                                case 0xA2:
                                    printf("Start of race, phase 2 ");
                                    break;
                                case 0xA3:
                                    printf("Start of race, phase 3 ");
                                    break;
                                case 0xA4:
                                    printf("End of race ");
                                    break;
                                case 0xA5:
                                    printf("Start of pause ");
                                    break;
                                case 0xA6:
                                    printf("End of pause ");
                                    break;
                                case 0xA7:
                                    printf("Abort race ");
                                    break;
                                default:
                                    printf("Unknown function %02x ", dataWord[8]);
                                    break;
                            }
                        }

                        if (dataWord[8] == 0xA1) 
                        {
                            /* If start of race (0xA1), next two bytes have different meaning. */
                            printf("Program values: %02x and %02x\n", dataWord[9], dataWord[10]);
                        }
                        else 
                        {
                            /* Display Identifiers. */
                            switch (dataWord[9]) 
                            {
                                case 0xA8:
                                    /* Documentation say this should be "1st position.  
                                       Actual use looks like this is really fast lap. */
                                    /* printf("1st position "); */
                                    printf("Fast lap ");
                                    break;
                                case 0xA9:
                                    printf("Fast lap ");
                                    break;
                                default:
                                    /* printf("Identifier %02x ", dataWord[9]); */
                                    break;
                            }

                            printf("\n");

                            /* Ignore lane number if it is a function. */
                            if (dataWord[7] != 0x00) 
                            {
                                /* Display Lane number. */
                                switch (dataWord[10])
                                {
                                    case 0x80:
                                        printf("lane 1 ");
                                        break;
                                    case 0x40:
                                        printf("lane 2 ");
                                        break;
                                    case 0x20:
                                        printf("lane 3 ");
                                        break;
                                    case 0x10:
                                        printf("lane 4 ");
                                        break;
                                    case 0x08:
                                        printf("lane 5 ");
                                        break;
                                    case 0x04:
                                        printf("lane 6 ");
                                        break;
                                    case 0x02:
                                        printf("lane 7 ");
                                        break;
                                    case 0x01:
                                        printf("lane 8 ");
                                        break;
                                    default:
                                        printf("Unknown lane number %02x\n", dataWord[10]);
                                        break;
                                }
                            }
                        }

                        /* Display Number of laps. */
                        printf("Laps %d\n", (dataWord[11]>>4)*1000 + (dataWord[11]&0xf)*100 + (dataWord[12]>>4)*10 + (dataWord[12]&0xf));

                        /* Display hours, minutes, seconds. */
                        printf("HH:MM:SS %1d%1d:%1d%1d:%1d%1d.", dataWord[13]>>4, dataWord[13]&0xf, dataWord[14]>>4, dataWord[14]&0xf, 
                            dataWord[15]>>4, dataWord[15]&0xf);
                        /* Display fractions of asecond. */
                        printf("%1d%1d%1d%1d.", dataWord[16]>>4, dataWord[16]&0xf, dataWord[17]>>4, dataWord[17]&0xf);

                        printf("\n\n");

                        /* Test checksum. */
                        for (i=1, checksum=0; i<18; i++) 
                        {
                            checksum += dataWord[i];
                        }
                        checksum += dataWord[19];
                        if ((checksum&0xff) != dataWord[18]) 
                        {
                            printf("Warning: Checksum failure.  Was %02x not %02x.\n", (checksum&0xff), dataWord[18]);
                        }

                        /* Display any errors in data word. */
                        if (dataWord[2] != TOTAL_BYTES) 
                        {
                            printf("Warning: Word length incorrect.  Was %02x not %02x.\n", dataWord[2], TOTAL_BYTES);
                        }
                        if (dataWord[TOTAL_BYTES-1] != END_BYTE) 
                        {
                            printf("Warning: End byte incorrect.  Was %02x not %02x.\n", dataWord[TOTAL_BYTES-1], END_BYTE);
                        }
                        /* Save dataWord. */
                        for (i=0; i<TOTAL_BYTES; i++) 
                        {
                            olddataWord[i] = dataWord[i];
                        }
                        fflush(stdout);
                    }
                }
            }
        }
        if (kbhit()) {
            c=getch();
            return;
        }
    }
}

//---------------------
void mainmenu(void){
    printf("\n%s\n", TITLE);
    printf("%s\n", REVISION);
    printf("ds300 cmds:\n");
    printf(" d DS300 mode\n");
    printf(" t term mode\n");
    printf(" h toggle hex mode\n");
    printf(" q quit\n");
}

//---------------------
void commmenu(void){
    printf("\n%s\n", TITLE);
    printf("%s\n", REVISION);
    printf("Select COMM Port (1-4)\n");
    printf("or q to quit\n");
}

/*
**  mygetc -- get a single character from the keyboard.
*/

int mygetc(void)
{
    while (!kbhit); /* Wait for character */
    return(getch());
}

//---------------------
void main(void){
//main program
char c;

    initvars();

    /* Initialize the user-selected COMM port. */
    commmenu();
    printf("port:");
    fflush(stdout);
    c=mygetc();
    printf("\n");
    switch(c){
        case '1': 
            if (initcom("com1"))
                exit(-1);
            else
                curcomm=1;
            break;
        case '2': 
            if (initcom("com2"))
                exit(-1);
            else
                curcomm=2;
            break;
        case '3': 
            if (initcom("com3"))
                exit(-1);
            else
                curcomm=3;
            break;
        case '4': 
            if (initcom("com4"))
                exit(-1);
            else
                curcomm=4;
            break;
        case 'q':
        default:
            exit(0);
            break;
    }

    while(c != 'q'){
        mainmenu();
        printf("\ncmd:");
        fflush(stdout);
        c=mygetc();
        printf("\n");
        switch(c){
            case 'd': 
                ds300(); 
                break;
            case 't': 
                term(); 
                break;
            case 'h': 
                hexmode^=1; 
                break;
            case 'q':
                closecom();
                exit(0);
                break;
            default:  
                mainmenu();
        }
    }
}
//---------------------
