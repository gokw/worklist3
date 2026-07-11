Attribute VB_Name = "modFilter"
'==============================================================
' modFilter - 開始予定(F列)ありでフィルタのトグル
'==============================================================
Option Explicit

Sub SetFilter()
Attribute SetFilter.VB_Description = "開始時間ありでフィルタ\r\n"
Attribute SetFilter.VB_ProcData.VB_Invoke_Func = "F\n14"
    If Not GuardSheet() Then Exit Sub

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ' フィルター適用済みなら解除、未適用なら適用
    If ws.AutoFilterMode Then
        SetFilterOFF
    Else
        SetFilterON
    End If
End Sub

Sub SetFilterON()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, colDay).End(xlUp).Row

    ' 開始予定列(F)が空白以外で絞り込む。
    ' AutoFilter の Field は範囲の左端からの相対位置。範囲が A 始まりなので列番号と一致する。
    ws.Range(COL_FIRST & ROW_HEADER & ":" & COL_LAST & lastRow) _
        .AutoFilter Field:=colPlanStart, Criteria1:="<>"
End Sub

Sub SetFilterOFF()
    Dim ws As Worksheet
    Set ws = ActiveSheet
    If ws.AutoFilterMode Then ws.AutoFilterMode = False
End Sub
