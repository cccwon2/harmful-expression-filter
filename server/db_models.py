from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text
from sqlalchemy.sql import func
from database import Base

class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    text = Column(Text, nullable=False)
    user_id = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False)
    model_type = Column(Text, nullable=True)
    threshold_used = Column(Float, nullable=True)
    is_harmful = Column(Boolean, default=True)
