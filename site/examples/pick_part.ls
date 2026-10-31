/PROG  PICK_PART
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "AR1 = approach mm";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 7;
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
   1:  ! AR[1] = approach height in mm ;
   2:  PR[11:approach]=PR[11:approach]-PR[11:approach] ;
   3:  PR[11,3:approach]=AR[1] ;
   4:J P[1:pick] 100% CNT50 Offset,PR[11:approach]    ;
   5:L P[1:pick] 250mm/sec FINE    ;
   6:  CLOSE HAND ;
   7:L P[1:pick] 500mm/sec CNT50 Offset,PR[11:approach]    ;
/POS
P[1:"pick"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   450.000  mm,	Y =  -120.000  mm,	Z =  -250.000  mm,
	W =   180.000 deg,	P =      .000 deg,	R =      .000 deg
};
/END
