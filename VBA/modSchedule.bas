Attribute VB_Name = "modSchedule"
'==============================================================
' modSchedule - 日付の移動操作
'   選択行の日付(A列)を進める/戻す/今日/週初へ。
'==============================================================
Option Explicit

' アクティブ行の日付セルを返すヘルパー(内部用)
Private Function DayCell() As Range
    Set DayCell = Cells(ActiveCell.Row, colDay)
End Function

Sub NextDay()
Attribute NextDay.VB_ProcData.VB_Invoke_Func = "L\n14"
    '翌日に回す
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    With DayCell()
        .Value = DateAdd("d", 1, .Value)
    End With
End Sub

Sub PreviousDay()
Attribute PreviousDay.VB_ProcData.VB_Invoke_Func = "H\n14"
    '前日に回す
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    With DayCell()
        .Value = DateAdd("d", -1, .Value)
    End With
End Sub

Sub SetToday()
Attribute SetToday.VB_ProcData.VB_Invoke_Func = "K\n14"
    '今日に戻す
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    DayCell().Value = Date
End Sub

Sub SetWeekday()
Attribute SetWeekday.VB_ProcData.VB_Invoke_Func = " \n14"
    'その週の月曜(週初)へ寄せる
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    With DayCell()
        .Value = .Value - Weekday(.Value, 7) + 8
    End With
End Sub
