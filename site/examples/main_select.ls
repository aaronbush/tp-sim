/PROG  MAIN_SELECT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "SELECT and CALL demo";
PROG_SIZE	= 0;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 13;
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
   1:  ! GI[1] picks the shape: 1=square 2=triangle ;
   2:  UFRAME_NUM=0 ;
   3:  UTOOL_NUM=1 ;
   4:J PR[4:HOME] 100% FINE    ;
   5:  R[5:shape]=GI[1:shape select] ;
   6:  SELECT R[5:shape]=1,CALL A_SQUARE ;
   7:  =2,CALL A_TRIANGLE ;
   8:  ELSE,JMP LBL[9] ;
   9:J PR[4:HOME] 100% FINE    ;
  10:  END ;
  11:  LBL[9:bad value] ;
  12:  ! nothing to draw for other values ;
  13:J PR[4:HOME] 100% FINE    ;
/POS
/END
