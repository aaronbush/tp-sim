/PROG  LOOP_SQUARES
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "LBL JMP IF demo";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 18;
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
   1:  ! Draw three squares in a row ;
   2:  UFRAME_NUM=0 ;
   3:  UTOOL_NUM=1 ;
   4:  R[1:count]=0 ;
   5:  PR[10:shift]=PR[10:shift]-PR[10:shift] ;
   6:J PR[4:HOME] 100% FINE    ;
   7:  LBL[1:next square] ;
   8:J P[1:above] 100% CNT50 Offset,PR[10:shift]    ;
   9:L P[2:corner] 250mm/sec FINE Offset,PR[10:shift]    ;
  10:L P[3] 250mm/sec FINE Offset,PR[10:shift]    ;
  11:L P[4] 250mm/sec FINE Offset,PR[10:shift]    ;
  12:L P[5] 250mm/sec FINE Offset,PR[10:shift]    ;
  13:L P[2:corner] 250mm/sec FINE Offset,PR[10:shift]    ;
  14:L P[1:above] 500mm/sec CNT50 Offset,PR[10:shift]    ;
  15:  PR[10,2:shift]=PR[10,2:shift]+70 ;
  16:  R[1:count]=R[1:count]+1 ;
  17:  IF R[1:count]<3,JMP LBL[1] ;
  18:J PR[4:HOME] 100% FINE    ;
/POS
P[1:"above"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   400.000  mm,	Y =  -120.000  mm,	Z =  -228.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[2:"corner"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   400.000  mm,	Y =  -120.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   450.000  mm,	Y =  -120.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   450.000  mm,	Y =   -70.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
P[5]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   400.000  mm,	Y =   -70.000  mm,	Z =  -278.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
/END
