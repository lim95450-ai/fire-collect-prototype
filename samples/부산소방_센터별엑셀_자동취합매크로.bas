Attribute VB_Name = "BusanFireMerge"
Option Explicit

' =============================================================================
' [부산소방재난본부 / 소방서] 센터별 제출 엑셀 일괄 자동취합 + 제출유무(O/X) 자동체크 매크로
' -----------------------------------------------------------------------------
' * 특징:
'   1. 외부 서버나 DB를 거치지 않고 담당자 행정망 PC 내부 폴더에서만 100% 동작하므로
'      개인정보(성명, 생년월일, 임용일자, 연락처 등)가 외부 서버로 전송되지 않습니다.
'   2. 폴더 내 파일명((신평)...xlsx, (감천)...xlsx 등)을 자동 분석해 [제출유무현황] 시트에
'      관할 센터·부서별 제출 완료(O) / 미제출(X) 여부를 자동으로 대조해 표시합니다.
'   3. 상단 문서 제목과 표 머리글은 딱 1번만 남기고 각 센터가 입력한 데이터 행만
'      원본 그대로(마스킹 없이) 아래로 깔끔하게 이어 붙여 줍니다.
' =============================================================================

Public Sub 부산소방_센터별엑셀_일괄취합()
    Dim fd As FileDialog
    Dim folderPath As String, fileName As String, headerRowInput As String
    Dim headerRow As Long, dataStartRow As Long
    Dim wbOut As Workbook, wsData As Worksheet, wsStat As Worksheet
    Dim wbSrc As Workbook, wsSrc As Worksheet
    Dim lastRow As Long, lastCol As Long, outRow As Long, statRow As Long
    Dim r As Long, c As Long, i As Long, fileCount As Long, totalRows As Long, copiedFromFile As Long
    Dim isFirstFile As Boolean, rowHasValue As Boolean, cellVal As String, firstColHeader As String
    Dim targets As Variant, submittedFiles() As String, submittedRows() As Long, isSub() As Boolean
    Dim submitCnt As Long, missingNames As String

    ' 관할 점검 대상 목록 (필요 시 소속 소방서 센터명으로 수정 가능)
    targets = Array("신평", "감천", "괴정", "하단", "다대", "사하구조대", "청문감사", "소방행정", "예방안전", "구조구급", "현장대응")
    ReDim submittedFiles(LBound(targets) To UBound(targets))
    ReDim submittedRows(LBound(targets) To UBound(targets))
    ReDim isSub(LBound(targets) To UBound(targets))

    ' 1. 취합할 엑셀 파일들이 들어있는 폴더 선택
    Set fd = Application.FileDialog(msoFileDialogFolderPicker)
    fd.Title = "[부산소방 자료취합] 각 센터·소방서 제출 엑셀 파일이 모인 폴더를 선택하세요"
    If fd.Show <> -1 Then Exit Sub
    folderPath = fd.SelectedItems(1)
    If Right(folderPath, 1) <> "\" Then folderPath = folderPath & "\"

    ' 2. 표 머리글(컬럼명) 행 번호 확인
    headerRowInput = InputBox( _
        "제출 서식에서 표 머리글(예: 순, 기관, 소속, 계급, 성명...)이 있는 행 번호를 입력하세요." & vbCrLf & vbCrLf & _
        "• 일반 소방서/본부 배포 서식: 4 또는 5" & vbCrLf & _
        "• 맞춤 다운로드 서식(상단 안내 포함): 8", _
        "표 머리글(컬럼명) 행 번호 지정", "5")
    If Trim(headerRowInput) = "" Or Not IsNumeric(headerRowInput) Then Exit Sub
    headerRow = CLng(headerRowInput)
    dataStartRow = headerRow + 1

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    On Error GoTo CleanUp

    Set wbOut = Workbooks.Add(xlWBATWorksheet)
    Set wsData = wbOut.Worksheets(1): wsData.Name = "취합결과"
    Set wsStat = wbOut.Worksheets.Add(After:=wsData): wsStat.Name = "제출유무현황"
    wsStat.Range("A1:E1").Value = Array("연번", "대상 센터/부서", "제출 유무", "취합 행 수", "제출 파일명")
    wsStat.Range("A1:E1").Font.Bold = True
    isFirstFile = True: outRow = 1

    fileName = Dir(folderPath & "*.xls*")
    Do While fileName <> ""
        If Left(fileName, 2) <> "~$" And InStr(1, fileName, "_취합결과", vbTextCompare) = 0 Then
            Set wbSrc = Workbooks.Open(folderPath & fileName, ReadOnly:=True, UpdateLinks:=0)
            Set wsSrc = wbSrc.Worksheets(1)
            lastRow = wsSrc.Cells(wsSrc.Rows.Count, 1).End(xlUp).Row
            For c = 2 To 15
                If wsSrc.Cells(wsSrc.Rows.Count, c).End(xlUp).Row > lastRow Then
                    lastRow = wsSrc.Cells(wsSrc.Rows.Count, c).End(xlUp).Row
                End If
            Next c
            lastCol = wsSrc.Cells(headerRow, wsSrc.Columns.Count).End(xlToLeft).Column
            If lastCol < 2 Then lastCol = 10

            If isFirstFile Then
                wsSrc.Range(wsSrc.Cells(1, 1), wsSrc.Cells(headerRow, lastCol)).Copy Destination:=wsData.Cells(1, 1)
                outRow = headerRow + 1: isFirstFile = False
            End If

            copiedFromFile = 0
            For r = dataStartRow To lastRow
                rowHasValue = False
                For c = 2 To lastCol
                    cellVal = Trim(CStr(wsSrc.Cells(r, c).Value))
                    If cellVal <> "" Then rowHasValue = True: Exit For
                Next c
                If rowHasValue Then
                    If InStr(1, CStr(wsSrc.Cells(r, 1).Value), "예시") > 0 Then rowHasValue = False
                End If
                If rowHasValue Then
                    For c = 1 To lastCol
                        wsData.Cells(outRow, c).Value = wsSrc.Cells(r, c).Value
                    Next c
                    outRow = outRow + 1: copiedFromFile = copiedFromFile + 1: totalRows = totalRows + 1
                End If
            Next r

            ' 파일명으로 어느 센터가 제출했는지 자동 매칭 (제출유무 O/X 체크)
            For i = LBound(targets) To UBound(targets)
                If InStr(1, fileName, CStr(targets(i)), vbTextCompare) > 0 Then
                    isSub(i) = True
                    submittedFiles(i) = fileName
                    submittedRows(i) = submittedRows(i) + copiedFromFile
                End If
            Next i

            fileCount = fileCount + 1
            wbSrc.Close SaveChanges:=False
        End If
        fileName = Dir()
    Loop

    ' [제출유무현황] 시트에 전체 대상 센터별 제출완료(O) / 미제출(X) 기록
    statRow = 2: submitCnt = 0: missingNames = ""
    For i = LBound(targets) To UBound(targets)
        wsStat.Cells(statRow, 1).Value = i - LBound(targets) + 1
        wsStat.Cells(statRow, 2).Value = targets(i)
        If isSub(i) Then
            wsStat.Cells(statRow, 3).Value = "제출완료 (O)"
            wsStat.Cells(statRow, 4).Value = submittedRows(i)
            wsStat.Cells(statRow, 5).Value = submittedFiles(i)
            submitCnt = submitCnt + 1
        Else
            wsStat.Cells(statRow, 3).Value = "미제출 (X)"
            wsStat.Cells(statRow, 3).Font.Color = RGB(200, 30, 30)
            wsStat.Cells(statRow, 3).Font.Bold = True
            wsStat.Cells(statRow, 4).Value = 0
            wsStat.Cells(statRow, 5).Value = "-"
            If missingNames <> "" Then missingNames = missingNames & ", "
            missingNames = missingNames & targets(i)
        End If
        statRow = statRow + 1
    Next i

    firstColHeader = Replace(Trim(CStr(wsData.Cells(headerRow, 1).Value)), " ", "")
    If firstColHeader = "연번" Or firstColHeader = "순" Or firstColHeader = "순번" Then
        For r = headerRow + 1 To outRow - 1
            wsData.Cells(r, 1).Value = r - headerRow
        Next r
    End If

    If outRow > headerRow Then
        With wsData.Range(wsData.Cells(headerRow, 1), wsData.Cells(outRow - 1, lastCol))
            .Borders.LineStyle = xlContinuous
            .Font.Name = "맑은 고딕": .Font.Size = 10
        End With
    End If
    wsData.Columns.AutoFit: wsStat.Columns.AutoFit: wsData.Activate
    MsgBox "총 " & fileCount & "개 파일(" & totalRows & "행) 원본 취합 완료!" & vbCrLf & _
           "• 제출 완료: " & submitCnt & "곳 / 전체 " & (UBound(targets) - LBound(targets) + 1) & "곳" & vbCrLf & _
           "• 미제출 기관: " & IIf(missingNames = "", "없음(전원 제출)", missingNames), vbInformation, "취합 및 제출유무 확인 완료"

CleanUp:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub
