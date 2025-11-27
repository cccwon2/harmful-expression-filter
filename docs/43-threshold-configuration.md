# 작업 43: Threshold(임계값) 설정 및 최적화

## 상태
✅ 완료

## 📋 작업 개요

유해 표현 분류 모델에서 사용되는 **Threshold(임계값)** 설정 및 최적화에 대한 문서입니다. Threshold는 모델이 출력한 유해 확률을 기반으로 최종 유해 여부를 판단하는 기준값입니다.

**목표**:

1. **Threshold 개념 이해**: Threshold의 역할과 분류 결과에 미치는 영향
2. **모델별 기본값 설정**: KoElectra와 Kanana 모델의 최적 Threshold 값
3. **Threshold 조정 가이드**: 환경 변수 또는 코드를 통한 설정 방법
4. **성능 평가**: Threshold 변경에 따른 정확도, 재현율, 정밀도 변화
5. **최적화 전략**: False Positive/False Negative 균형 조정

**배경**:

- AI 모델은 텍스트를 입력받아 유해 확률(0.0 ~ 1.0)을 출력합니다
- Threshold를 기준으로 확률이 높으면 유해, 낮으면 정상으로 분류합니다
- Threshold 값에 따라 민감도(Sensitivity)와 특이도(Specificity)가 달라집니다
- 모델별로 최적 Threshold가 다르므로 모델 타입에 따라 다른 값을 사용합니다

**관련 작업**:

- Task 21 (텍스트 분석 API) ✅ - 기본 분석 엔드포인트
- Task 41 (KoElectra 분류기 통합) ✅ - KoElectra 모델 연동

## 🎯 Threshold 개념

### 1. Threshold란?

Threshold는 **이진 분류(Binary Classification)에서 클래스를 구분하는 기준값**입니다. 

```
모델 출력: 유해 확률 = 0.75 (75%)
Threshold = 0.5

판단: 0.75 >= 0.5 → 유해 (is_harmful = True)
```

### 2. Threshold의 역할

```python
# server/nlp/harmful_classifier.py
prob_harm = float(probs[idx_for_harm].item())  # 모델이 출력한 유해 확률
is_harmful = prob_harm >= self.threshold       # Threshold와 비교
```

- **낮은 Threshold (예: 0.1)**: 
  - 더 많은 텍스트를 유해로 판단 (민감도 ↑, 특이도 ↓)
  - False Positive 증가 (정상 텍스트를 유해로 오판)
  - False Negative 감소 (유해 텍스트를 놓치지 않음)

- **높은 Threshold (예: 0.9)**:
  - 더 적은 텍스트를 유해로 판단 (민감도 ↓, 특이도 ↑)
  - False Positive 감소 (정상 텍스트를 정상으로 정확히 판단)
  - False Negative 증가 (유해 텍스트를 놓칠 수 있음)

### 3. 모델별 기본 Threshold

현재 시스템에서 사용하는 모델별 기본 Threshold:

| 모델 | 기본 Threshold | 근거 |
|------|---------------|------|
| **KoElectra** | **0.5** | 이진 분류의 표준 임계값, 균형잡힌 성능 |
| **Kanana** | **0.22** | 모델 특성상 낮은 확률에서도 유해 판단 필요 |

**설정 위치**: `server/main.py`

```python
# 2. 모델 타입에 따른 threshold 설정
if model_type_env == "koelectra":
    target_threshold = 0.5  # KoElectra threshold
else:
    target_threshold = 0.22  # Kanana threshold
```

## 🔧 Threshold 설정 방법

### 1. 환경 변수를 통한 설정 (권장하지 않음)

현재는 환경 변수로 직접 설정하는 기능이 없습니다. 코드에서 모델 타입에 따라 자동으로 설정됩니다.

### 2. 코드 수정을 통한 설정

`server/main.py`의 `lifespan` 함수에서 Threshold 값을 변경:

```python
# 2. 모델 타입에 따른 threshold 설정
if model_type_env == "koelectra":
    target_threshold = 0.5  # 원하는 값으로 변경
else:
    target_threshold = 0.22  # 원하는 값으로 변경
```

### 3. HarmfulTextClassifier 직접 초기화

`HarmfulTextClassifier` 클래스의 `__init__` 메서드에서 `threshold` 파라미터를 직접 지정:

```python
classifier = HarmfulTextClassifier(
    model_path=target_model_path,
    base_model_name=target_base_model,
    use_quantization=use_quantization,
    threshold=0.3  # 커스텀 threshold 값
)
```

### 4. 환경 변수 추가 (향후 개선)

향후 환경 변수로 Threshold를 설정할 수 있도록 개선 가능:

```python
# server/main.py (개선 예시)
threshold_env = os.getenv("CLASSIFIER_THRESHOLD", "").strip()
if threshold_env:
    try:
        target_threshold = float(threshold_env)
        LOGGER.info(f"[Init] 🔧 환경 변수에서 Threshold 설정: {target_threshold}")
    except ValueError:
        LOGGER.warning(f"[Init] ⚠️ 잘못된 THRESHOLD 값: {threshold_env}. 기본값 사용")
        # 모델별 기본값으로 폴백
        if model_type_env == "koelectra":
            target_threshold = 0.5
        else:
            target_threshold = 0.22
else:
    # 모델별 기본값 사용
    if model_type_env == "koelectra":
        target_threshold = 0.5
    else:
        target_threshold = 0.22
```

## 📊 Threshold 조정 가이드

### 1. Threshold 선택 기준

#### 민감도(Sensitivity) 우선 (낮은 Threshold)

**사용 시나리오**:
- 유해 표현을 절대 놓치면 안 되는 경우
- False Negative를 최소화해야 하는 경우
- 예: 아동 보호, 극단적 콘텐츠 필터링

**권장 Threshold**: 0.1 ~ 0.3

**장점**:
- 유해 표현을 거의 놓치지 않음
- 보수적인 필터링

**단점**:
- 정상 텍스트도 유해로 오판할 가능성 증가
- 사용자 경험 저하 (과도한 차단)

#### 특이도(Specificity) 우선 (높은 Threshold)

**사용 시나리오**:
- 정상 텍스트를 잘못 차단하면 안 되는 경우
- False Positive를 최소화해야 하는 경우
- 예: 일반 채팅 필터링, 자동화된 콘텐츠 관리

**권장 Threshold**: 0.7 ~ 0.9

**장점**:
- 정상 텍스트를 정확히 통과시킴
- 사용자 경험 향상

**단점**:
- 유해 표현을 놓칠 가능성 증가
- 보안 위험 증가

#### 균형잡힌 설정 (중간 Threshold)

**사용 시나리오**:
- 일반적인 유해 표현 필터링
- False Positive와 False Negative의 균형이 중요한 경우

**권장 Threshold**: 0.4 ~ 0.6

**장점**:
- 균형잡힌 성능
- 대부분의 사용 사례에 적합

**단점**:
- 특정 시나리오에서는 최적이 아닐 수 있음

### 2. Threshold 최적화 프로세스

#### Step 1: 테스트 데이터셋 준비

```python
test_cases = [
    ("안녕하세요", False),  # 정상 텍스트
    ("오늘 날씨가 좋네요", False),  # 정상 텍스트
    ("욕설 비방 혐오", True),  # 명확한 유해 표현
    ("이건 좀 애매한 표현", False),  # 경계 케이스
    # ... 더 많은 테스트 케이스
]
```

#### Step 2: 여러 Threshold 값으로 테스트

```python
import requests

BASE_URL = "http://127.0.0.1:8000"

def evaluate_threshold(threshold: float, test_cases: list):
    """특정 threshold 값에 대한 성능 평가"""
    # Note: 현재는 코드 수정이 필요하지만, 향후 API로 threshold 전달 가능
    
    true_positives = 0  # 유해를 유해로 정확히 판단
    true_negatives = 0  # 정상을 정상으로 정확히 판단
    false_positives = 0  # 정상을 유해로 오판
    false_negatives = 0  # 유해를 정상으로 오판
    
    for text, expected_harmful in test_cases:
        response = requests.post(
            f"{BASE_URL}/analyze",
            json={"text": text}
        )
        result = response.json()
        predicted_harmful = result.get('has_violation', False)
        confidence = result.get('ai_analysis', {}).get('confidence', 0.0)
        
        # Threshold 적용 (현재는 서버에서 적용되지만, 로컬에서도 확인 가능)
        predicted_harmful_threshold = confidence >= threshold
        
        if expected_harmful and predicted_harmful_threshold:
            true_positives += 1
        elif not expected_harmful and not predicted_harmful_threshold:
            true_negatives += 1
        elif not expected_harmful and predicted_harmful_threshold:
            false_positives += 1
        elif expected_harmful and not predicted_harmful_threshold:
            false_negatives += 1
    
    # 성능 지표 계산
    total = len(test_cases)
    accuracy = (true_positives + true_negatives) / total
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0
    f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    
    return {
        'threshold': threshold,
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1_score': f1_score,
        'true_positives': true_positives,
        'true_negatives': true_negatives,
        'false_positives': false_positives,
        'false_negatives': false_negatives
    }

# 여러 threshold 값 테스트
thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
results = []

for threshold in thresholds:
    result = evaluate_threshold(threshold, test_cases)
    results.append(result)
    print(f"Threshold {threshold:.1f}: Accuracy={result['accuracy']:.3f}, "
          f"Precision={result['precision']:.3f}, Recall={result['recall']:.3f}, "
          f"F1={result['f1_score']:.3f}")

# 최적 threshold 선택 (F1 Score 기준)
best_result = max(results, key=lambda x: x['f1_score'])
print(f"\n최적 Threshold: {best_result['threshold']:.2f}")
print(f"F1 Score: {best_result['f1_score']:.3f}")
```

#### Step 3: ROC Curve 분석 (고급)

ROC Curve를 그려서 최적 Threshold를 찾을 수 있습니다:

```python
import matplotlib.pyplot as plt
import numpy as np

def plot_roc_curve(test_cases, confidences, labels):
    """ROC Curve 그리기"""
    thresholds = np.arange(0.0, 1.01, 0.01)
    tpr_list = []  # True Positive Rate (Recall)
    fpr_list = []  # False Positive Rate
    
    for threshold in thresholds:
        tp = sum(1 for conf, label in zip(confidences, labels) if conf >= threshold and label == 1)
        fp = sum(1 for conf, label in zip(confidences, labels) if conf >= threshold and label == 0)
        tn = sum(1 for conf, label in zip(confidences, labels) if conf < threshold and label == 0)
        fn = sum(1 for conf, label in zip(confidences, labels) if conf < threshold and label == 1)
        
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
        
        tpr_list.append(tpr)
        fpr_list.append(fpr)
    
    # AUC 계산
    auc = np.trapz(tpr_list, fpr_list)
    
    # 그래프 그리기
    plt.figure(figsize=(8, 6))
    plt.plot(fpr_list, tpr_list, label=f'ROC Curve (AUC = {auc:.3f})')
    plt.plot([0, 1], [0, 1], 'k--', label='Random')
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title('ROC Curve')
    plt.legend()
    plt.grid(True)
    plt.show()
    
    return thresholds, tpr_list, fpr_list, auc
```

## 🔍 현재 구현 상세

### 1. Threshold 적용 위치

**파일**: `server/nlp/harmful_classifier.py`

```python
def predict(self, text: str) -> ClassificationResult:
    # ... 모델 추론 ...
    
    logits = outputs.logits  # shape: [1, 2]
    probs = self._torch.nn.functional.softmax(logits, dim=-1)[0]
    
    # label=1 (유해) 확률 추출
    idx_for_harm = 1
    prob_harm = float(probs[idx_for_harm].item())
    
    # 🔥 threshold 적용
    is_harmful = prob_harm >= self.threshold
    
    return ClassificationResult(
        is_harmful=is_harmful,
        confidence=prob_harm,  # 원본 확률 값 반환
        text=text,
    )
```

### 2. 모델별 Threshold 설정

**파일**: `server/main.py`

```python
# 2. 모델 타입에 따른 threshold 설정
if model_type_env == "koelectra":
    target_threshold = 0.5  # KoElectra threshold
else:
    target_threshold = 0.22  # Kanana threshold

# 3. Classifier 초기화
classifier = HarmfulTextClassifier(
    model_path=target_model_path,
    base_model_name=target_base_model,
    use_quantization=use_quantization,
    threshold=target_threshold  # 🔥 모델별 threshold 적용
)
```

### 3. API 응답 구조

Threshold는 서버 내부에서만 사용되며, API 응답에는 **원본 확률 값(confidence)**이 포함됩니다:

```json
{
  "has_violation": true,
  "ai_analysis": {
    "is_harmful": true,
    "confidence": 0.75  // 원본 확률 값 (threshold와 비교 전)
  }
}
```

클라이언트에서 필요시 다른 threshold로 재판단할 수 있습니다.

## 🧪 테스트 방법

### 1. Threshold 값 확인

서버 시작 시 로그에서 Threshold 값 확인:

```bash
cd server
uvicorn main:app --reload
```

로그 출력:
```
[Init] - Threshold: 0.5  # KoElectra
# 또는
[Init] - Threshold: 0.22  # Kanana
```

### 2. 다양한 확률 값으로 테스트

```python
import requests

BASE_URL = "http://127.0.0.1:8000"

test_texts = [
    "안녕하세요",  # 낮은 확률 예상
    "이건 좀 애매한 표현",  # 중간 확률 예상
    "욕설 비방 혐오",  # 높은 확률 예상
]

for text in test_texts:
    response = requests.post(
        f"{BASE_URL}/analyze",
        json={"text": text}
    )
    result = response.json()
    ai_analysis = result.get('ai_analysis', {})
    confidence = ai_analysis.get('confidence', 0.0)
    is_harmful = result.get('has_violation', False)
    
    print(f"텍스트: {text}")
    print(f"  확률: {confidence:.4f} ({confidence*100:.1f}%)")
    print(f"  유해 판단: {is_harmful} (threshold >= 0.5)")
    print(f"  판단 근거: {'유해' if confidence >= 0.5 else '정상'}")
    print()
```

### 3. Threshold 변경 테스트

1. `server/main.py`에서 threshold 값 변경
2. 서버 재시작
3. 동일한 테스트 케이스로 재테스트
4. 결과 비교

## 📈 성능 벤치마크

### KoElectra 모델 (Threshold = 0.5)

| Threshold | 정확도 | 정밀도 | 재현율 | F1 Score |
|-----------|--------|--------|--------|----------|
| 0.3 | ~0.85 | ~0.75 | ~0.95 | ~0.84 |
| 0.4 | ~0.88 | ~0.82 | ~0.90 | ~0.86 |
| **0.5** | **~0.90** | **~0.88** | **~0.85** | **~0.86** |
| 0.6 | ~0.88 | ~0.92 | ~0.75 | ~0.83 |
| 0.7 | ~0.85 | ~0.95 | ~0.65 | ~0.77 |

### Kanana 모델 (Threshold = 0.22)

| Threshold | 정확도 | 정밀도 | 재현율 | F1 Score |
|-----------|--------|--------|--------|----------|
| 0.1 | ~0.80 | ~0.65 | ~0.98 | ~0.78 |
| **0.22** | **~0.87** | **~0.80** | **~0.90** | **~0.85** |
| 0.3 | ~0.88 | ~0.85 | ~0.82 | ~0.83 |
| 0.4 | ~0.87 | ~0.90 | ~0.75 | ~0.82 |
| 0.5 | ~0.85 | ~0.93 | ~0.65 | ~0.77 |

**참고**: 위 수치는 예시이며, 실제 모델과 데이터셋에 따라 다를 수 있습니다.

## ✅ 수락 기준

- [x] 모델별 기본 Threshold 값 설정 (KoElectra: 0.5, Kanana: 0.22)
- [x] Threshold 기반 분류 로직 구현
- [x] 서버 시작 시 Threshold 값 로그 출력
- [x] API 응답에 원본 확률 값 포함
- [ ] 환경 변수로 Threshold 설정 가능 (향후 개선)
- [ ] Threshold 최적화 도구 제공 (향후 개선)

## 🔄 향후 개선 사항

### 1. 환경 변수 지원

```env
# server/.env
CLASSIFIER_THRESHOLD=0.5  # 선택적, 없으면 모델별 기본값 사용
```

### 2. API로 Threshold 전달

```python
@app.post("/analyze")
async def analyze_text(
    request: AnalyzeRequest,
    threshold: Optional[float] = None  # 쿼리 파라미터로 threshold 전달
):
    # threshold가 제공되면 사용, 없으면 기본값 사용
    ...
```

### 3. 동적 Threshold 조정

학습 데이터나 사용자 피드백을 기반으로 Threshold를 자동으로 조정하는 기능.

### 4. Threshold별 성능 대시보드

웹 대시보드에서 Threshold 값을 변경하고 실시간으로 성능 지표를 확인할 수 있는 기능.

## 🔍 문제 해결

### 문제 1: Threshold가 너무 낮아서 정상 텍스트도 차단됨

**증상**: 정상적인 대화도 유해로 판단됨

**해결 방법**:
1. Threshold 값을 높임 (예: 0.5 → 0.6)
2. `server/main.py`에서 해당 모델의 `target_threshold` 값 증가

### 문제 2: Threshold가 너무 높아서 유해 표현을 놓침

**증상**: 명확한 유해 표현도 정상으로 판단됨

**해결 방법**:
1. Threshold 값을 낮춤 (예: 0.5 → 0.4)
2. `server/main.py`에서 해당 모델의 `target_threshold` 값 감소

### 문제 3: 모델별 최적 Threshold를 모르겠음

**해결 방법**:
1. 테스트 데이터셋 준비
2. 여러 Threshold 값으로 성능 평가
3. F1 Score가 가장 높은 Threshold 선택
4. 또는 Precision/Recall 중 우선순위에 따라 선택

## 📚 참고 자료

- [Binary Classification Threshold](https://en.wikipedia.org/wiki/Threshold_(statistics))
- [ROC Curve and AUC](https://en.wikipedia.org/wiki/Receiver_operating_characteristic)
- [Precision and Recall](https://en.wikipedia.org/wiki/Precision_and_recall)
- [F1 Score](https://en.wikipedia.org/wiki/F-score)

