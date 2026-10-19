/PROG  A_TRIANGLE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "called by MAIN_SELECT";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 8;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  UFRAME_NUM=0 ;
   2:  UTOOL_NUM=1 ;
   3:J P[1:above] 100% CNT50    ;
   4:L P[2:corner] 250mm/sec FINE    ;
   5:L P[3] 250mm/sec FINE    ;
   6:L P[4] 250mm/sec FINE    ;
   7:L P[2:corner] 250mm/sec FINE    ;
   8:L P[1:above] 500mm/sec CNT50    ;
/POS
P[1:"above"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   380.000  mm,	Y =   -40.000  mm,	Z =  -228.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[2:"corner"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   380.000  mm,	Y =   -40.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   460.000  mm,	Y =   -10.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   380.000  mm,	Y =    20.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
/END
