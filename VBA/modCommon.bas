Attribute VB_Name = "modCommon"
'==============================================================
' modCommon - 全モジュール共通のヘルパー
'   重複していた定型処理をここに集約する。
'==============================================================
Option Explicit

'――――――――――――――――――――――――――――――――――
' シート判定
'――――――――――――――――――――――――――――――――――

' アクティブシートがマクロ実行対象か(メッセージ無し)
Public Function IsMacroSheet() As Boolean
    Dim nm As String
    nm = ActiveSheet.Name
    IsMacroSheet = (nm = SHEET_WORKLIST) Or (nm = SHEET_ALT)
End Function

' 実行対象でなければメッセージを出して False を返すガード。
'   各 Sub の先頭で「If Not GuardSheet() Then Exit Sub」と書く。
Public Function GuardSheet() As Boolean
    If IsMacroSheet() Then
        GuardSheet = True
    Else
        MsgBox "このシートでマクロは実行できません", vbExclamation
        GuardSheet = False
    End If
End Function

' 旧名の後方互換エイリアス(既存呼び出し・Immediate ウィンドウ用)
Public Function CheckMacroSheet() As Boolean
    CheckMacroSheet = IsMacroSheet()
End Function

'――――――――――――――――――――――――――――――――――
' 自動保存チェック
'   ON/OFF の設定はブックの定義名(非表示)に保存し、再オープン後も保持する。
'   既定は ON。ToggleAutoSaveCheck で切り替える。
'――――――――――――――――――――――――――――――――――
' 保存用の定義名は関数名と衝突させないこと(衝突すると Application.Run が解決不能になる)
Private Const AUTOSAVE_SETTING_NAME As String = "wlAutoSaveCheck"

Public Sub CheckAutoSave()
    If Not AutoSaveCheckEnabled() Then Exit Sub   ' 設定OFFなら何もしない

    Dim wb As Workbook
    Set wb = ThisWorkbook
    If Not wb.AutoSaveOn Then
        MsgBox "自動保存がオフになっています。最後に保存した以降の操作は保存できません。"
        wb.AutoSaveOn = True
    End If
End Sub

' 自動保存チェックが有効か(設定が無ければ既定 True)
Public Function AutoSaveCheckEnabled() As Boolean
    Dim nm As Name
    On Error Resume Next
    Set nm = ThisWorkbook.Names(AUTOSAVE_SETTING_NAME)
    On Error GoTo 0

    If nm Is Nothing Then
        AutoSaveCheckEnabled = True
    Else
        AutoSaveCheckEnabled = (InStr(1, nm.RefersTo, "TRUE", vbTextCompare) > 0)
    End If
End Function

' 自動保存チェックの ON/OFF を設定(ブックに保存される)
Public Sub SetAutoSaveCheckEnabled(ByVal enabled As Boolean)
    Dim refers As String
    If enabled Then refers = "=TRUE" Else refers = "=FALSE"
    ' 同名があれば上書きされる
    ThisWorkbook.Names.Add Name:=AUTOSAVE_SETTING_NAME, RefersTo:=refers, Visible:=False
End Sub

' 自動保存チェックの ON/OFF を切り替える(マクロとして実行)
Public Sub ToggleAutoSaveCheck()
    Dim newState As Boolean
    newState = Not AutoSaveCheckEnabled()
    SetAutoSaveCheckEnabled newState

    If newState Then
        MsgBox "自動保存チェックを ON にしました。", vbInformation
    Else
        MsgBox "自動保存チェックを OFF にしました。" & vbCrLf & _
               "(各マクロ実行時に自動保存の確認を行いません)", vbInformation
    End If
End Sub

'――――――――――――――――――――――――――――――――――
' 行操作
'――――――――――――――――――――――――――――――――――

' 指定行の表範囲(A:O)を複製して下に挿入し、複製後の編集対象行(r+1)を返す。
'   元行と新行は同一内容。呼び出し側は戻り値の行を Cells(row, colXxx) で編集する。
Public Function DuplicateRowBelow(ByVal r As Long) As Long
    Dim src As Range
    Set src = Range(COL_FIRST & r & ":" & COL_LAST & r)
    src.Copy
    src.Insert Shift:=xlDown
    Application.CutCopyMode = False
    DuplicateRowBelow = r + 1
End Function

' 指定行の複数列を空文字でクリアする。
'   例: ClearCells r, colActStart, colActEnd, colPlanStart
Public Sub ClearCells(ByVal r As Long, ParamArray cols() As Variant)
    Dim c As Variant
    For Each c In cols
        Cells(r, c).Value = ""
    Next c
End Sub

' 1列ぶんのデータ範囲アドレスを返す。例: ColData("A") -> "A11:A255"
Public Function ColData(ByVal colLetter As String) As String
    ColData = colLetter & ROW_FIRST & ":" & colLetter & ROW_LAST
End Function

'――――――――――――――――――――――――――――――――――
' クリップボード
'――――――――――――――――――――――――――――――――――

' クリップボードのテキストを取得(テキストが無ければ空文字)
Public Function GetClipboardText() As String
    Dim obj As New MSForms.DataObject
    On Error Resume Next
    obj.GetFromClipboard
    If obj.GetFormat(1) Then GetClipboardText = obj.GetText
    On Error GoTo 0
End Function

'――――――――――――――――――――――――――――――――――
' 描画・計算の一時停止(重い処理の高速化)
'――――――――――――――――――――――――――――――――――
Public Sub PerfBegin()
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False
End Sub

Public Sub PerfEnd()
    Application.EnableEvents = True
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
End Sub
