/PROG  PICK_PLACE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "FOR WAIT RO frame demo";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 26;
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
   1:  ! Build user frame 1 at the table corner ;
   2:  PR[9:table]=PR[9:table]-PR[9:table] ;
   3:  PR[9,1:table]=350 ;
   4:  PR[9,2:table]=-150 ;
   5:  PR[9,3:table]=-278 ;
   6:  UFRAME[1]=PR[9:table] ;
   7:  UFRAME_NUM=1 ;
   8:  UTOOL_NUM=1 ;
   9:  PR[10:place ofs]=PR[10:place ofs]-PR[10:place ofs] ;
  10:  RO[1:grip open]=ON ;
  11:J PR[4:HOME] 100% FINE    ;
  12:  FOR R[1:part]=1 TO 3 ;
  13:  WAIT DI[1:part ready]=ON ;
  14:J P[1:above pick] 100% CNT50    ;
  15:L P[2:pick] 250mm/sec FINE    ;
  16:  RO[1:grip open]=OFF ;
  17:  WAIT .30(sec) ;
  18:L P[1:above pick] 500mm/sec CNT50    ;
  19:J P[3:above place] 100% CNT50 Offset,PR[10:place ofs]    ;
  20:L P[4:place] 250mm/sec FINE Offset,PR[10:place ofs]    ;
  21:  RO[1:grip open]=ON ;
  22:  WAIT .30(sec) ;
  23:L P[3:above place] 500mm/sec CNT50 Offset,PR[10:place ofs]    ;
  24:  PR[10,2:place ofs]=PR[10,2:place ofs]+60 ;
  25:  ENDFOR ;
  26:J PR[4:HOME] 100% FINE    ;
/POS
P[1:"above pick"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    40.000  mm,	Y =    30.000  mm,	Z =    60.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[2:"pick"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    40.000  mm,	Y =    30.000  mm,	Z =      .000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[3:"above place"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   150.000  mm,	Y =    40.000  mm,	Z =    60.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[4:"place"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   150.000  mm,	Y =    40.000  mm,	Z =      .000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
/END
