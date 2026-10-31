/PROG  STACK_PARTS
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "CALL macro IF WAIT offset";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 21;
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
   1:  ! Stack 3 parts on top of each other ;
   2:  ! Uses CALL, macros, IF, WAIT, offsets ;
   3:  UFRAME_NUM=0 ;
   4:  UTOOL_NUM=1 ;
   5:  R[1:count]=0 ;
   6:  PR[10:stack ofs]=PR[10:stack ofs]-PR[10:stack ofs] ;
   7:  OPEN HAND ;
   8:J P[1:clear] 100% FINE    ;
   9:  LBL[1:next part] ;
  10:  WAIT DI[1:part ready]=ON TIMEOUT,LBL[9] ;
  11:  CALL PICK_PART(60) ;
  12:J P[2:above place] 100% CNT50 Offset,PR[10:stack ofs]    ;
  13:L P[3:place] 250mm/sec FINE Offset,PR[10:stack ofs]    ;
  14:  OPEN HAND ;
  15:L P[2:above place] 500mm/sec CNT50 Offset,PR[10:stack ofs]    ;
  16:  R[1:count]=R[1:count]+1 ;
  17:  PR[10,3:stack ofs]=PR[10,3:stack ofs]+20 ;
  18:  DO[1:part done]=PULSE,0.5sec ;
  19:  IF R[1:count]<3,JMP LBL[1] ;
  20:  LBL[9:done] ;
  21:J P[1:clear] 100% FINE    ;
/POS
P[1:"clear"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   400.000  mm,	Y =     0.000  mm,	Z =  -100.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[2:"above place"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   450.000  mm,	Y =   120.000  mm,	Z =  -190.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[3:"place"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   450.000  mm,	Y =   120.000  mm,	Z =  -250.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
/END
