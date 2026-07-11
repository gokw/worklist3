Attribute VB_Name = "modConfig"
'==============================================================
' modConfig - 設定・定数の一元管理
'   表のレイアウトや対象シートが変わったら、原則このモジュールだけ直す。
'   列の挿入・移動・シート名変更への耐性をここで担保する。
'==============================================================
Option Explicit

'―― 対象シート ――――――――――――――――――――――――
Public Const SHEET_WORKLIST As String = "worklist"        ' 主シート
Public Const SHEET_ALT      As String = "開発タスク一覧"  ' 別名(実行許可)
Public Const SHEET_SYSTEM   As String = "system"          ' 作業用(リンク変換等)

'―― 表の範囲(行) ―――――――――――――――――――――――
Public Const ROW_TEMPLATE As Long = 9   ' 書式・数式のテンプレート行(9行目)
Public Const ROW_HEADER   As Long = 10  ' ヘッダー行
Public Const ROW_FIRST    As Long = 11  ' データ先頭行
Public Const ROW_LAST     As Long = 255 ' データ最終行

'―― 表の範囲(列・文字) ―――――――――――――――――――
Public Const COL_FIRST As String = "A"
Public Const COL_LAST  As String = "O"

' よく使う範囲アドレス(ROW/COL 定数と整合させること)
Public Const RANGE_TABLE As String = "A10:O255"   ' ヘッダー含む全体
Public Const RANGE_DATA  As String = "A11:O255"   ' データ部のみ

'―― 列番号(1=A) ――――――――――――――――――――――――
'  Offset 算術をやめ、すべてこの定数で列を指定する。
Public Const colDay       As Long = 1    ' A 日付
Public Const colStatus    As Long = 2    ' B st(ステータス)
Public Const colRepeat    As Long = 3    ' C rpt(繰り返し)
Public Const colContents  As Long = 4    ' D タスク名
Public Const colEstMin    As Long = 5    ' E 見積(分)
Public Const colPlanStart As Long = 6    ' F 開始予定(HHMM)
Public Const colPlanEnd   As Long = 7    ' G 終了予定(計算列)
Public Const colActStart  As Long = 8    ' H 開始実績(HHMM)
Public Const colActEnd    As Long = 9    ' I 終了実績(HHMM)
Public Const colActMin    As Long = 10   ' J 実績(分・計算列)
Public Const colMemo1     As Long = 11   ' K メモ
Public Const colMemo2     As Long = 12   ' L メモ
Public Const colMemo3     As Long = 13   ' M メモ
Public Const colTheme     As Long = 14   ' N theme
Public Const colRemain    As Long = 15   ' O remain 残り時間(計算列)

'―― デバッグ ―――――――――――――――――――――――――
Public Const flgDebugTime As Boolean = False   ' True で実行時間を計測表示
