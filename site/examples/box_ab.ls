/PROG  BOX_AB
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 878;
CREATE		= DATE 26-09-25  TIME 22:04:36;
MODIFIED	= DATE 26-10-02  TIME 21:50:22;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 9;
MEMORY_SIZE	= 1214;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
LOCAL_REGISTERS	= 0,0,0;
/APPL
/APPL

AUTO_SINGULARITY_HEADER;
  ENABLE_SINGULARITY_AVOIDANCE   : TRUE;
  CYCLE_REFERENCE = 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0;
  CYCLE_TARGET =   0.00 ;
/MN
   1:  UFRAME_NUM=0 ;
   2:  UTOOL_NUM=1 ;
   3:J PR[4:HOME_AB] 100% FINE    ;
   4:J P[2] 60% CNT100    ;
   5:L P[3] 250mm/sec FINE    ;
   6:L P[4] max_speed CNT100    ;
   7:J P[5] 100% CNT25    ;
   8:L P[6] 250mm/sec FINE    ;
   9:J PR[4:HOME_AB] 100% FINE    ;
/POS
P[2]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   528.282  mm,	Y =  -134.374  mm,	Z =  -276.854  mm,
	W =  -179.979 deg,	P =      .045 deg,	R =      .005 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   528.271  mm,	Y =   122.055  mm,	Z =  -276.864  mm,
	W =  -179.979 deg,	P =      .047 deg,	R =      .005 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   327.621  mm,	Y =   122.018  mm,	Z =  -276.885  mm,
	W =  -179.981 deg,	P =      .049 deg,	R =      .002 deg
};
P[5]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   327.623  mm,	Y =  -132.368  mm,	Z =  -276.891  mm,
	W =  -179.980 deg,	P =      .050 deg,	R =      .002 deg
};
P[6:""]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   528.846  mm,	Y =  -132.379  mm,	Z =  -276.944  mm,
	W =  -179.979 deg,	P =      .054 deg,	R =     -.000 deg
};
/END
