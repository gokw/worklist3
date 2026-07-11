Attribute VB_Name = "modAlarm"
'==============================================================
' modAlarm - 終了予定(G列)を使った簡易アラーム
'   StartAlarmWatcher で監視開始、毎分 CheckAlarmTime が自走、
'   StopAlarmWatcher で停止。
'==============================================================
Option Explicit

' 監視状態(このモジュール内だけで使う)
Private nextCheck As Date
Private targetTime As Variant
Private hasAlarmFired As Boolean

Private Const MIN_DELAY_MINUTES As Double = 1   ' これ未満の残り時間なら監視しない

Sub StartAlarmWatcher()
    ' アクティブ行の終了予定(G列)を目標時刻にする
    targetTime = Cells(ActiveCell.Row, colPlanEnd).Value

    ' 時刻として有効か判定(日付、または 0〜1 のシリアル時刻)
    If Not IsDate(targetTime) And _
       Not (IsNumeric(targetTime) And targetTime > 0 And targetTime < 1) Then Exit Sub

    If IsNumeric(targetTime) Then targetTime = CDate(targetTime)

    ' 今日の日付と合成
    targetTime = Date + TimeValue(targetTime)

    Dim diffMinutes As Double
    diffMinutes = (targetTime - Now) * 24 * 60
    If diffMinutes < MIN_DELAY_MINUTES Then Exit Sub

    hasAlarmFired = False
    nextCheck = Now + TimeValue("00:01:00")

    ' 前回の予約を念のためキャンセル(失敗してもよい)
    On Error Resume Next
    Application.OnTime nextCheck, "CheckAlarmTime", , False
    On Error GoTo 0

    Application.OnTime nextCheck, "CheckAlarmTime"

    MsgBox "タスクを開始します！あと " & Format(diffMinutes, "0.0") & _
           " 分で " & Format(targetTime, "HH:MM") & " に終了目標です！", vbInformation
End Sub

Sub CheckAlarmTime()
    If Format(Now, "HH:MM") = Format(targetTime, "HH:MM") Then
        If Not hasAlarmFired Then
            hasAlarmFired = True
            Beep
            MsgBox "アラーム時刻です！", vbExclamation, "アラーム"
        End If
    End If

    nextCheck = Now + TimeValue("00:01:00")
    Application.OnTime nextCheck, "CheckAlarmTime"
End Sub

Sub StopAlarmWatcher()
    On Error Resume Next
    Application.OnTime nextCheck, "CheckAlarmTime", , False
    On Error GoTo 0
    MsgBox "アラームチェックを停止しました", vbInformation
End Sub
