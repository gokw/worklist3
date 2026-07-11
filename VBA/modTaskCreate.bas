Attribute VB_Name = "modTaskCreate"
'==============================================================
' modTaskCreate - タスクの新規作成(手入力 / カレンダー / Teamsリンク / 統合)
'   ※ InsertCalendar / InsertTeamsLink は system シートや特定のクリップボード
'     形式に依存する。system シートが無いブックでは動作しない点に注意。
'==============================================================
Option Explicit

'――――――――――――――――――――――――――――――――――
' 新規タスク: 空行を挿入し、クリップボード/入力から contents を設定。
'――――――――――――――――――――――――――――――――――
Sub NewTask()
Attribute NewTask.VB_ProcData.VB_Invoke_Func = "N\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    ' 空行を1行挿入(挿入後も ActiveCell.Row は同じ=新しい空行)
    ActiveCell.EntireRow.Insert
    Dim r As Long
    r = ActiveCell.Row

    ' フォント装飾だけクリア(D,K,L,M)
    Call ClearFontStylesInSpecificCols(r)

    ' 日付を今日に
    Cells(r, colDay).Value = Date

    ' クリップボードのテキストを初期値に contents を入力
    Dim clip As String
    clip = GetClipboardText()

    Dim strContents As Variant
    If clip <> "" Then
        strContents = Application.InputBox(prompt:="contens", Default:=clip, _
            Title:="タスクを記載ください", Type:=2)
        If VarType(strContents) = vbString Then
            strContents = Replace(strContents, vbCrLf, "")  ' 改行除去
            strContents = Replace(strContents, vbCr, "")
            strContents = Replace(strContents, vbLf, "")
        End If
    Else
        strContents = Application.InputBox(prompt:="contens", Default:="", _
            Title:="タスクを記載くださいね", Type:=2)
    End If

    ' キャンセル(False)時は何も書かない
    If VarType(strContents) <> vbBoolean Then
        Cells(r, colContents).Value = strContents
    End If

    Cells(r, colTheme).Select
End Sub

'――――――――――――――――――――――――――――――――――
' カレンダー貼り付け: クリップボードの予定(2行目=日付 時刻)から行を作る。
'――――――――――――――――――――――――――――――――――
Sub InsertCalendar()
Attribute InsertCalendar.VB_ProcData.VB_Invoke_Func = " \n14"
    Call CheckAutoSave

    Dim clip As String
    clip = GetClipboardText()
    If clip = "" Then Exit Sub

    Dim lines As Variant
    lines = Split(clip, vbCrLf)

    ' 先頭に空行が来る場合のズレ補正
    Dim adjust As Long
    If lines(0) = "" Then adjust = 1 Else adjust = 0

    Dim strTitle As String
    strTitle = lines(0 + adjust)

    ' 例: 23/2/27 (月) 10:00 - 11:00
    Dim dt As Variant
    dt = Split(lines(1 + adjust), " ")

    Dim strDate As String
    strDate = dt(0)

    Dim dtStart As Date, dtEnd As Date
    dtStart = dt(2)
    dtEnd = dt(4)

    Dim nLen As Long
    nLen = DateDiff("n", dtStart, dtEnd)          ' 所要(分)

    Dim strTimeStart As String
    strTimeStart = Format(dtStart, "hhmm")

    ' 行を複製して下を予定で埋める
    Dim r As Long, newRow As Long
    r = ActiveCell.Row
    newRow = DuplicateRowBelow(r)

    Cells(newRow, colDay).Value = Format(strDate, "yyyy/m/d")
    Cells(newRow, colContents).Value = strTitle
    Cells(newRow, colEstMin).Value = nLen
    Cells(newRow, colPlanStart).Value = strTimeStart
    ClearCells newRow, colStatus, colRepeat, colActStart, colActEnd, _
               colActMin, colMemo1, colMemo2, colMemo3, colTheme

    Cells(newRow, colTheme).Select
    Application.CutCopyMode = False
End Sub

'――――――――――――――――――――――――――――――――――
' Teamsリンク貼り付け: system シートでリンクを整形して1行作る。
'――――――――――――――――――――――――――――――――――
Sub InsertTeamsLink()
Attribute InsertTeamsLink.VB_ProcData.VB_Invoke_Func = " \n14"
    Call CheckAutoSave

    Dim sysWs As Worksheet
    Set sysWs = Sheets(SHEET_SYSTEM)

    ' system シートで貼り付け → A4 にURL、A1 に表示文字列を作る
    sysWs.Cells.ClearContents
    sysWs.Select
    sysWs.Range("A1").Select
    ActiveSheet.Paste
    sysWs.Range("A4").Select
    ActiveSheet.PasteSpecial Format:="テキスト", Link:=False, DisplayAsIcon:=False

    Dim url As String
    url = sysWs.Range("A4").Value

    Dim displayText As String
    displayText = sysWs.Range("A1").Value

    sysWs.Range("A1").Select
    sysWs.Hyperlinks.Add Anchor:=Selection, Address:=url, TextToDisplay:=displayText

    ' worklist に戻って行を作る
    Sheets(SHEET_WORKLIST).Select

    Dim r As Long, newRow As Long
    r = ActiveCell.Row
    newRow = DuplicateRowBelow(r)

    Cells(newRow, colDay).Value = Date
    Cells(newRow, colContents).Value = sysWs.Range("A1").Value

    If sysWs.Range("A1").Hyperlinks.Count > 0 Then
        Dim linkAddress As String
        linkAddress = sysWs.Range("A1").Hyperlinks(1).Address
        Cells(newRow, colContents).Hyperlinks.Add _
            Anchor:=Cells(newRow, colContents), Address:=linkAddress
    Else
        MsgBox "ハイパーリンクが存在しません。"
    End If

    Cells(newRow, colEstMin).Value = 0
    Cells(newRow, colMemo1).Value = sysWs.Range("A2").Value
    ClearCells newRow, colStatus, colRepeat, colPlanStart, colActStart, _
               colActEnd, colActMin, colMemo2, colMemo3, colTheme

    Cells(newRow, colTheme).Select
    Application.CutCopyMode = False

    sysWs.Cells.ClearContents
End Sub

'――――――――――――――――――――――――――――――――――
' 統合: クリップボード内容で Teams / カレンダー / 新規 を振り分ける。
'――――――――――――――――――――――――――――――――――
Sub UnifiedInsertTask()
Attribute UnifiedInsertTask.VB_ProcData.VB_Invoke_Func = "V\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    Dim clip As String
    clip = GetClipboardText()

    Dim lines As Variant
    lines = Split(clip, vbCrLf)

    If InStr(clip, "https://") > 0 And InStr(clip, "teams.microsoft.com") > 0 Then
        InsertTeamsLink
    Else
        If UBound(lines) >= 1 Then
            If IsCalendarText(lines(1)) Then
                InsertCalendar
                Exit Sub
            End If
        End If
        NewTask
    End If
End Sub

' 文字列が「年/月/日」で始まるか
Function IsCalendarText(s As Variant) As Boolean
    Dim reg As Object
    Set reg = CreateObject("VBScript.RegExp")
    reg.Pattern = "^\d{1,4}/\d{1,2}/\d{1,2}"
    reg.IgnoreCase = True
    IsCalendarText = reg.Test(Trim(CStr(s)))
End Function

'――――――――――――――――――――――――――――――――――
' 選択した「開始予定」セル群へ、見積(時間)を積み上げて連番の開始時刻を設定。
'――――――――――――――――――――――――――――――――――
Sub SetSequentialStartHHMM()
Attribute SetSequentialStartHHMM.VB_ProcData.VB_Invoke_Func = "T\n14"
    On Error GoTo ErrHandler

    ' ヘッダー行から列番号を取得
    Dim headerRow As Range
    Set headerRow = ActiveSheet.Rows(ROW_HEADER)

    Dim startColVar As Variant, timeColVar As Variant
    startColVar = Application.Match("開始予定", headerRow, 0)
    timeColVar = Application.Match("時間", headerRow, 0)
    If IsError(startColVar) Or IsError(timeColVar) Then
        MsgBox "「開始予定」列または「時間」列が見つかりません。", vbCritical
        Exit Sub
    End If

    Dim startCol As Long, timeCol As Long
    startCol = CLng(startColVar)
    timeCol = CLng(timeColVar)

    ' 選択範囲チェック
    If TypeName(Selection) <> "Range" Then Exit Sub
    Dim sel As Range, cell As Range
    Set sel = Selection
    For Each cell In sel.Cells
        If cell.Column <> startCol Then
            MsgBox "開始予定列以外が選択されています。処理を中止します。", vbExclamation
            Exit Sub
        End If
        If cell.Row <= ROW_HEADER Then
            MsgBox "1～10行目が選択されています。ヘッダー部分のため処理を中止します。", vbExclamation
            Exit Sub
        End If
    Next cell

    Dim cumulativeMin As Long
    cumulativeMin = -1   ' 初期化フラグ

    Dim area As Range
    Dim rowTime As Long, startVal As Long, startMin As Long
    Dim nextHH As Long, nextMM As Long
    Dim inputStr As String, defaultStr As String

    ' Ctrl+クリックの選択順(Areas順)を保持して処理
    For Each area In sel.Areas
        For Each cell In area.Cells
            If IsNumeric(Cells(cell.Row, timeCol).Value) Then
                rowTime = CLng(Cells(cell.Row, timeCol).Value)
            Else
                rowTime = 0
            End If

            If cumulativeMin < 0 Then
                ' 最初のセル: 開始時刻を決定
                If IsNumeric(cell.Value) And Len(CStr(cell.Value)) >= 3 Then
                    startVal = CLng(cell.Value)
                Else
                    defaultStr = Format(Now, "hhmm")
                    inputStr = InputBox("最初の開始予定時刻を入力してください（hhmm形式 例：" & defaultStr & "）", _
                                        "開始時刻入力", defaultStr)
                    If inputStr = "" Then
                        MsgBox "入力がキャンセルされました。処理を終了します。", vbInformation
                        Exit Sub
                    End If
                    If Not IsNumeric(inputStr) Or Len(inputStr) < 3 Then
                        MsgBox "hhmm形式の整数で入力してください。", vbCritical
                        Exit Sub
                    End If
                    startVal = CLng(inputStr)
                End If

                startMin = (startVal \ 100) * 60 + (startVal Mod 100)
                cell.Value = startVal
                cumulativeMin = startMin + rowTime
            Else
                ' 2番目以降: 累積分から hhmm を算出
                nextHH = cumulativeMin \ 60
                nextMM = cumulativeMin Mod 60
                cell.Value = nextHH * 100 + nextMM
                cumulativeMin = cumulativeMin + rowTime
            End If
        Next cell
    Next area

    Exit Sub

ErrHandler:
    MsgBox "予期しないエラーが発生しました: " & Err.Description, vbCritical
End Sub
