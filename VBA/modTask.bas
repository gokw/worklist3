Attribute VB_Name = "modTask"
'==============================================================
' modTask - タスクのライフサイクル(開始・終了・中断・待ち・ランダム開始)
'   行は「複製して下に挿入し、下の行(r+1)を編集」する方式で統一。
'==============================================================
Option Explicit

'――――――――――――――――――――――――――――――――――
' 開始: H(開始)が空なら開始時刻を入力。入っていれば終了確認。
'――――――――――――――――――――――――――――――――――
Sub StartTask()
Attribute StartTask.VB_ProcData.VB_Invoke_Func = "O\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    Dim r As Long
    r = ActiveCell.Row

    If Cells(r, colActStart).Value = "" Then
        ' 開始予定(F)があればそれを、無ければ最終時刻(I4)を初期値に
        Dim defaultStart As Variant
        If Cells(r, colPlanStart).Value = "" Then
            defaultStart = Range("$I$4").Value
        Else
            defaultStart = Cells(r, colPlanStart).Value
        End If

        Dim timeStart As Variant
        timeStart = Application.InputBox(prompt:="タスク開始", Default:=defaultStart, _
            Title:="開始時刻を入力してください。CANSELで現在時刻をセットします。", Type:=2)

        If timeStart = False Then
            Cells(r, colActStart).Value = Format(Now(), "HHMM")
        ElseIf timeStart = "" Then
            Cells(r, colActStart).Value = Range("$I$4").Value
        Else
            Cells(r, colActStart).Value = timeStart
        End If
    Else
        ' 既に開始済み → 終了するか確認
        If MsgBox("タスクを終了しますか？", vbYesNo + vbQuestion + vbDefaultButton2, "確認") = vbYes Then
            Call EndTask
        End If
    End If
End Sub

'――――――――――――――――――――――――――――――――――
' 終了: I(終了)に時刻を入れ、contents の選択肢処理と rpt(繰り返し)処理を行う。
'――――――――――――――――――――――――――――――――――
Sub EndTask()
Attribute EndTask.VB_ProcData.VB_Invoke_Func = "Q\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    Dim r As Long
    r = ActiveCell.Row

    ' 開始していなければ終了できない
    If Cells(r, colActStart).Value = "" Then
        MsgBox "開始していないタスクです"
        Exit Sub
    End If

    If Cells(r, colActEnd).Value <> "" Then
        MsgBox "既に終了されています"
        Exit Sub
    End If

    ' 終了時刻を入力(初期値=終了予定 G)
    Dim timeEnd As Variant
    timeEnd = Application.InputBox(prompt:="タスク終了", _
        Default:=Format(Cells(r, colPlanEnd).Value, "HHMM"), _
        Title:="終了時刻を入力してください。CANSELで現在時刻をセットします。", Type:=1)

    If timeEnd = False Or timeEnd = "" Then
        Cells(r, colActEnd).Value = Format(Now(), "HHMM")
    Else
        Cells(r, colActEnd).Value = timeEnd
    End If

    ' contents(D)の選択肢処理。形式 "選択肢A/選択肢B：補足" のとき番号で選ばせる。
    Dim dValue As String
    dValue = Cells(r, colContents).Value
    If dValue <> "" And InStr(dValue, "：") > 0 Then
        Dim parts As Variant
        parts = Split(dValue, "：")
        If parts(0) <> "" And InStr(parts(0), "/") > 0 Then
            Dim subParts As Variant
            subParts = Split(parts(0), "/")
            If UBound(subParts) > 0 Then
                Dim itemList As String, i As Long
                itemList = ""
                For i = LBound(subParts) To UBound(subParts)
                    itemList = itemList & (i + 1) & ": " & subParts(i) & vbCrLf
                Next i

                Dim selectedIndex As Variant
                selectedIndex = Application.InputBox(prompt:="選択してください:" & vbCrLf & itemList, Type:=1)

                If IsNumeric(selectedIndex) And selectedIndex > 0 And selectedIndex <= UBound(subParts) + 1 Then
                    Cells(r, colContents).Value = subParts(selectedIndex - 1)
                Else
                    MsgBox "無効な選択です"
                End If
            End If
        End If
    End If

    ' rpt(C)処理: 繰り返し指定があれば翌occurrenceを複製生成
    If Cells(r, colRepeat).Value = "" Then Exit Sub

    Dim rpt As String
    rpt = Cells(r, colRepeat).Value

    Dim reg As Object
    Set reg = CreateObject("VBScript.RegExp")
    With reg
        .Pattern = "[r|R][d|w|m|y]\d"
        .IgnoreCase = False
        .Global = True
    End With

    If reg.Execute(rpt).Count = 0 Then
        ' 不正な rpt → 終了時刻を取り消して C へ
        MsgBox "rptの値が不正です([r開始時間コピーしない|Rする][d日|w週|m月|y年]\d※)"
        Cells(r, colActEnd).Value = ""
        Cells(r, colRepeat).Select
        Exit Sub
    End If

    ' r=開始時刻コピーしない / R=する
    Dim flgCopy As String
    flgCopy = Left(rpt, 1)

    Dim rptType As String
    rptType = Mid(rpt, 2, 1)
    If rptType = "y" Then
        rptType = "yyyy"
    ElseIf rptType = "w" Then
        rptType = "ww"
    End If

    Dim rptNum As Long
    rptNum = CLng(Right(rpt, Len(rpt) - 2))

    ' 行を複製して下(newRow)を次回分にする
    Dim newRow As Long
    newRow = DuplicateRowBelow(r)

    Cells(newRow, colDay).Value = DateAdd(rptType, rptNum, Cells(newRow, colDay).Value)
    Cells(newRow, colContents).Value = dValue        ' 元の contents を書き戻す
    ClearCells newRow, colActStart, colActEnd        ' 実績開始・終了を消去
    If flgCopy = "r" Then Cells(newRow, colPlanStart).Value = ""  ' 開始予定も消去
End Sub

'――――――――――――――――――――――――――――――――――
' 中断(割り込み): 元タスクを「消化分」と「残り」に分割し、任意で割込みタスクを追加。
'   ※ Sub 名の綴り(InterruputTask)はショートカット維持のため変更しない。
'――――――――――――――――――――――――――――――――――
Sub InterruputTask()
Attribute InterruputTask.VB_ProcData.VB_Invoke_Func = "I\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    If MsgBox("割り込みますか？", vbYesNo + vbQuestion + vbDefaultButton2, "確認") <> vbYes Then Exit Sub

    Dim r As Long
    r = ActiveCell.Row

    Dim fTime As Variant, rTime As Variant, nTime As Variant
    fTime = Cells(r, colEstMin).Value                       ' 見積(E)
    Cells(r, colActEnd).Value = Format(Now(), "HHMM")       ' 終了(I)= 今
    rTime = Cells(r, colActMin).Value                       ' 実績(J)

    If fTime > rTime Then
        nTime = fTime - rTime
    Else
        nTime = 0
    End If

    ' 行を複製: 上(r)=消化分、下(r+1)=残り
    Dim remainRow As Long
    remainRow = DuplicateRowBelow(r)
    Cells(r, colEstMin).Value = rTime               ' 上=実績分
    ClearCells remainRow, colPlanStart, colActStart, colActEnd
    Cells(remainRow, colEstMin).Value = nTime       ' 下=残り見積

    ' 割込みタスク名の入力(任意)
    Dim strContents As Variant
    strContents = Application.InputBox(prompt:="タスク中断", Default:="", _
        Title:="割込みタスク名を入力してください。CANSELで中断処理のみを行います", Type:=2)

    Dim cursorRow As Long
    cursorRow = remainRow

    If strContents <> False Then
        ' 残り行を複製し、上(remainRow)を割込みタスクにする
        Dim intrRow As Long
        intrRow = remainRow
        DuplicateRowBelow remainRow              ' 残りは下(remainRow+1)へ退避
        ClearCells intrRow, colActStart, colActEnd, colEstMin
        Cells(intrRow, colPlanStart).Value = Format(Now(), "HHMM")
        Cells(intrRow, colContents).Value = strContents
        Cells(intrRow, colActStart).Value = Format(Now(), "HHMM")
        cursorRow = intrRow
    End If

    Cells(cursorRow, colEstMin).Select
End Sub

'――――――――――――――――――――――――――――――――――
' 待ち(w): 行を複製し F/H/I を消去、E=0。終了済み(I有)なら st(B)に "w"。
'――――――――――――――――――――――――――――――――――
Sub WaitTask()
Attribute WaitTask.VB_ProcData.VB_Invoke_Func = "W\n14"
    Call CheckAutoSave
    If Not GuardSheet() Then Exit Sub

    Dim r As Long
    r = ActiveCell.Row

    Dim newRow As Long
    newRow = DuplicateRowBelow(r)

    ' 終了済み(I に値)なら st に "w" を立てる(消去より前に判定)
    If Cells(newRow, colActEnd).Value <> "" Then Cells(newRow, colStatus).Value = "w"

    Cells(newRow, colEstMin).Value = 0
    ClearCells newRow, colPlanStart, colActStart, colActEnd

    ' contents(D)末尾が ":" なら追記入力
    If Right(Cells(newRow, colContents).Value, 1) = ":" Then
        Dim inputText As String
        inputText = InputBox("テキストを入力してください")
        If inputText <> "" Then
            Cells(newRow, colContents).Value = Cells(newRow, colContents).Value & inputText
        End If
    End If

    Cells(newRow, colEstMin).Select
End Sub

'――――――――――――――――――――――――――――――――――
' 当日タスクからランダムに1件選んで開始する。
'――――――――――――――――――――――――――――――――――
Sub StartRandomTodayTask()
Attribute StartRandomTodayTask.VB_ProcData.VB_Invoke_Func = "Z\n14"
    If Not GuardSheet() Then Exit Sub

    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim tasks As Collection
    Set tasks = New Collection

    Dim r As Long
    For r = ROW_FIRST To ROW_LAST
        If ws.Cells(r, colDay).Value = Date Then
            ' 開始予定(F)も開始(H)も空
            If ws.Cells(r, colPlanStart).Value = "" And ws.Cells(r, colActStart).Value = "" Then
                Dim stVal As String
                stVal = CStr(ws.Cells(r, colStatus).Value)
                ' st が空、またはアルファベット1文字
                If stVal = "" Or stVal Like "[A-Za-z]" Then
                    tasks.Add r
                End If
            End If
        End If
    Next r

    If tasks.Count = 0 Then
        MsgBox "該当するタスクが見つかりませんでした。", vbInformation
        Exit Sub
    End If

    Randomize
    Dim selRow As Long
    selRow = tasks(Int(tasks.Count * Rnd) + 1)

    ws.Cells(selRow, colActStart).Select
    Call StartTask
End Sub
