Attribute VB_Name = "modTable"
'==============================================================
' modTable - 表の並べ替え・数式復元・書式(条件付き書式)
'   SortTable -> RepairTable -> MakeFormatRule の順で連携する。
'==============================================================
Option Explicit

Sub SortTable()
Attribute SortTable.VB_ProcData.VB_Invoke_Func = "S\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    Dim startTime As Single
    startTime = Timer

    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim nowRow As Long
    nowRow = ActiveCell.Row

    ' 並べ替え条件(優先度の低い順に Add し、最後に Apply)
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("A")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' 日付
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("H")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' 開始
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("F")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' 開始予定
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("B")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' st
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("C")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' rpt
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("E")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' 見積時間
    ws.Sort.SortFields.Add2 Key:=ws.Range(ColData("D")), SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal  ' theme(contents)

    With ws.Sort
        .SetRange ws.Range(RANGE_TABLE)
        .Header = xlYes
        .MatchCase = False
        .Orientation = xlTopToBottom
        .SortMethod = xlPinYin
        .Apply
    End With
    ws.Sort.SortFields.Clear

    Call RepairTable

    ' I4 に最終時刻(MAX)を入れる
    ws.Range("I4").Value = "=MAX(I11:I255)"

    ' 元の行に戻る
    ws.Range("A" & nowRow).Select

    If flgDebugTime Then
        MsgBox "実行時間: " & (Timer - startTime) & "秒"
    End If
End Sub

'――――――――――――――――――――――――――――――――――
' 9行目(テンプレート)の書式を表全体へ復元する
'――――――――――――――――――――――――――――――――――
Sub RestoreStyle()
Attribute RestoreStyle.VB_ProcData.VB_Invoke_Func = " \n14"
    If Not GuardSheet() Then Exit Sub

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ws.Range(COL_FIRST & ROW_TEMPLATE & ":" & COL_LAST & ROW_TEMPLATE).Copy
    ws.Range(RANGE_DATA).PasteSpecial Paste:=xlPasteFormats, _
        Operation:=xlNone, SkipBlanks:=False, Transpose:=False
    Application.CutCopyMode = False
End Sub

'――――――――――――――――――――――――――――――――――
' 各セルの計算式を9行目テンプレートから戻し、書式を作り直す
'――――――――――――――――――――――――――――――――――
Sub RepairTable()
    If Not GuardSheet() Then Exit Sub

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ' 集計セル(B2:B4)。計算式を変更(2026/1/6)
    ws.Range("B2").Value = "=TIME(0, SUMIFS(E11:E255, A11:A255, A1, B11:B255, ""<>??""), 0)"
    ws.Range("B3").Value = "=TIME(0,SUMIF(A11:A255,A1,J11:J255),0)"
    ws.Range("B4").Value = "=TIME(0, SUMIFS(O11:O255, A11:A255, A1, B11:B255, ""<>??""), 0)"

    ' 日付ごとの集計(E2:J2)
    ws.Range("E2").Value = "=TIME(0,SUMIF($A$11:$A$255,E1,$E$11:$E$255),0)"
    ws.Range("E2").AutoFill Destination:=ws.Range("E2:J2")

    ' 9行目テンプレートの計算式(G/J/O)
    ws.Range("G9").Value = "=IF(OR(E9="""",F9=""""),"""",TIMEVALUE(CONCATENATE(LEFT(TEXT(F9,""0000""),2),"":"",RIGHT(TEXT(F9,""0000""),2)))+TIME(0,E9,0))"
    ws.Range("J9").Value = "=IF(I9<>"""",MINUTE(TIMEVALUE(CONCATENATE(LEFT(TEXT(I9,""0000""),2),"":"",RIGHT(TEXT(I9,""0000""),2)))-TIMEVALUE(CONCATENATE(LEFT(TEXT(H9,""0000""),2),"":"",RIGHT(TEXT(H9,""0000""),2))))+HOUR(TIMEVALUE(CONCATENATE(LEFT(TEXT(I9,""0000""),2),"":"",RIGHT(TEXT(I9,""0000""),2)))-TIMEVALUE(CONCATENATE(LEFT(TEXT(H9,""0000""),2),"":"",RIGHT(TEXT(H9,""0000""),2))))*60,"""")"
    ws.Range("O9").Value = "=IF(I9<>"""",0,E9)"

    ' 9行目の計算式を表へコピー
    Call PerfBegin
    CopyTemplateDown ws, "G"
    CopyTemplateDown ws, "J"
    CopyTemplateDown ws, "O"

    ' 塗りつぶしをクリア
    With ws.Range(RANGE_DATA).Interior
        .Pattern = xlNone
        .TintAndShade = 0
        .PatternTintAndShade = 0
    End With
    Call PerfEnd

    Call MakeFormatRule
End Sub

' 9行目の1列を11行目へコピーし、データ範囲下端までオートフィルする(内部用)
Private Sub CopyTemplateDown(ByVal ws As Worksheet, ByVal colLetter As String)
    ws.Range(colLetter & ROW_TEMPLATE).Copy Destination:=ws.Range(colLetter & ROW_FIRST)
    ws.Range(colLetter & ROW_FIRST).AutoFill _
        Destination:=ws.Range(ColData(colLetter)), Type:=xlFillDefault
End Sub

'――――――――――――――――――――――――――――――――――
' 条件付き書式を作り直す
'――――――――――――――――――――――――――――――――――
Sub MakeFormatRule()
    If Not GuardSheet() Then Exit Sub

    Dim ws As Worksheet
    Set ws = ActiveSheet

    Cells.FormatConditions.Delete

    Dim rng As Range
    Set rng = ws.Range(RANGE_DATA)

    ' 今日の日程は色替え
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$A$1=$A11:$O255"
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .PatternThemeColor = xlThemeColorAccent4
        .ThemeColor = xlThemeColorAccent4
        .TintAndShade = 0.799981688894314
        .PatternTintAndShade = 0.599963377788629
    End With

    ' 開始予定が無ければ目立たせる(st も空)
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=AND($B11="""",$F11="""")"
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .Color = RGB(255, 167, 167)
        .TintAndShade = 0
    End With

    ' アクティブ(開始済み H<>"")
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$H11<>"""""
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .PatternColorIndex = xlAutomatic
        .ThemeColor = xlThemeColorAccent4
        .TintAndShade = 0.399945066682943
    End With

    ' 終了済み(I<>"")
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$I11<>"""""
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .PatternColorIndex = xlAutomatic
        .ThemeColor = xlThemeColorDark1
        .TintAndShade = -0.249946592608417
    End With

    ' st がハンマー(U+1F528)の行を色替え
    Dim hammer As String
    hammer = ChrW(&HD83D) & ChrW(&HDD28)
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$B11=""" & hammer & """"
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .Color = RGB(255, 200, 120)
        .TintAndShade = 0
    End With

    ' theme が無い(N="")
    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$N11="""""
    rng.FormatConditions(rng.FormatConditions.Count).SetFirstPriority
    With rng.FormatConditions(1).Interior
        .PatternColorIndex = xlAutomatic
        .ThemeColor = xlThemeColorAccent6
        .TintAndShade = 0.599963377788629
    End With
End Sub

'――――――――――――――――――――――――――――――――――
' 指定行のフォント装飾だけをクリア(D, K, L, M列)
'――――――――――――――――――――――――――――――――――
Sub ClearFontStylesInSpecificCols(ByVal rowNum As Long)
    Dim col As Variant
    For Each col In Array(colContents, colMemo1, colMemo2, colMemo3)
        With Cells(rowNum, col).Font
            .Bold = False
            .Italic = False
            .Underline = xlUnderlineStyleNone
            .Strikethrough = False
            .ColorIndex = xlColorIndexAutomatic
        End With
    Next col
End Sub
